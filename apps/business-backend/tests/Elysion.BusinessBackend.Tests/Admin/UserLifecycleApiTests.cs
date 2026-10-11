using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Admin;

/// <summary>Deactivating a person and handing over what they owned (ADR 0027, #668).</summary>
public class UserLifecycleApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly string[] OfflineAccess = ["offline_access"];

    private ApiFactory _factory = null!;
    private HttpClient _admin = null!;
    private HttpClient _internal = null!;
    private readonly Dictionary<string, User> _users = [];
    private Room _room = null!;
    private Board _board = null!;

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        _admin = Client("kc-admin", "elysion-admin");
        _internal = _factory.CreateInternalClient();

        foreach (var name in new[] { "anna", "bob", "carl", "dora" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), $"kc-{name}", name, $"{name}@example.com", Start);
        }

        // Anna created the room and the board (no membership row for the creator); Bob is an Editor of the board, Carl an Owner of it.
        _room = Room.Create(Guid.CreateVersion7(), "Design team", Start, _users["anna"].Id);
        _board = Board.Create(Guid.CreateVersion7(), "Roadmap", Start, _users["anna"].Id);
        _board.RoomId = _room.Id;
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(_room,
            _board,
            BoardMembership.Create(_board.Id, _users["bob"].Id, BoardRole.Editor, Start),
            BoardMembership.Create(_board.Id, _users["carl"].Id, BoardRole.Owner, Start));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown()
    {
        _admin.Dispose();
        _internal.Dispose();
        _factory.Dispose();
    }

    private HttpClient Client(string subject, params string[] realmRoles)
    {
        var claims = new List<Claim>
        {
            new("sub", subject), new("email", $"{subject}@example.com"), new("preferred_username", subject)
        };
        if (realmRoles.Length > 0)
        {
            claims.Add(new Claim("realm_access",
                JsonSerializer.Serialize(new { roles = OfflineAccess.Concat(realmRoles) }),
                JsonClaimValueTypes.Json));
        }

        return _factory.CreateAuthenticatedClient(subject, claims);
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private Guid Id(string name) => _users[name].Id;

    private Task<HttpResponseMessage> Deactivate(string name) =>
        _admin.PostAsync($"/admin/users/{Id(name)}/deactivate", null);

    private Task<HttpResponseMessage> Transfer(string from, string to) =>
        _admin.PostAsync("/admin/boards/transfer", Json(new { fromUserId = Id(from), toUserId = Id(to) }));

    private async Task<T> InDb<T>(Func<ElysionDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    // ---------------------------------------------------------------- the refusal

    [Test]
    public async Task A_deactivated_person_is_refused_on_every_request_with_a_code_the_shell_knows()
    {
        using var anna = Client("kc-anna");
        (await anna.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await Deactivate("anna")).StatusCode.ShouldBe(HttpStatusCode.OK);

        foreach (var url in new[]
                 {
                     "/boards", $"/boards/{_board.Id}", $"/boards/{_board.Id}/membership/me", "/rooms",
                     "/users?query=bo"
                 })
        {
            var response = await anna.GetAsync(url);
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, url);
            var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
            problem.GetProperty("code").GetString().ShouldBe("account-deactivated", url);
        }

        (await anna.PostAsync("/boards", Json(new { name = "New" }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task Reactivating_gives_the_access_back()
    {
        using var anna = Client("kc-anna");
        await Deactivate("anna");
        (await anna.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var response = await _admin.PostAsync($"/admin/users/{Id("anna")}/reactivate", null);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<AdminUserDetailDto>())!.DeactivatedAt.ShouldBeNull();
        (await anna.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task The_realtime_service_is_told_that_a_deactivated_person_has_no_role()
    {
        (await _internal.GetAsync($"/internal/boards/{_board.Id}/access?sub=kc-bob")).StatusCode.ShouldBe(HttpStatusCode
            .OK);

        await Deactivate("bob");

        (await _internal.GetAsync($"/internal/boards/{_board.Id}/access?sub=kc-bob")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    // ---------------------------------------------------------------- the endpoints

    [Test]
    public async Task Deactivating_answers_the_detail_and_is_idempotent_and_audited_once()
    {
        var first = await Deactivate("bob");
        var again = await Deactivate("bob");

        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        again.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await first.Content.ReadFromJsonAsync<AdminUserDetailDto>())!.DeactivatedAt.ShouldNotBeNull();
        var entries = await InDb(db => db.AuditEntries
            .Where(e => e.Action == AuditActions.UserDeactivated && e.SubjectId == Id("bob"))
            .ToListAsync());
        entries.Count.ShouldBe(1);
    }

    [Test]
    public async Task An_administrator_cannot_deactivate_themselves()
    {
        // The administrator's own row exists after their first request.
        await _admin.GetAsync("/admin/stats");
        var adminId = await InDb(db => db.Users.Where(u => u.Subject == "kc-admin").Select(u => u.Id).SingleAsync());

        var response = await _admin.PostAsync($"/admin/users/{adminId}/deactivate", null);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await _admin.GetAsync("/admin/stats")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task An_unknown_person_is_a_404_and_a_person_without_the_role_a_403()
    {
        (await _admin.PostAsync($"/admin/users/{Guid.NewGuid()}/deactivate", null)).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        (await _admin.PostAsync($"/admin/users/{Guid.NewGuid()}/reactivate", null)).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);

        using var bob = Client("kc-bob");
        (await bob.PostAsync($"/admin/users/{Id("carl")}/deactivate", null)).StatusCode.ShouldBe(HttpStatusCode
            .Forbidden);
        (await bob.PostAsync($"/admin/users/{Id("carl")}/reactivate", null)).StatusCode.ShouldBe(HttpStatusCode
            .Forbidden);
        (await bob.PostAsync("/admin/boards/transfer", Json(new { fromUserId = Id("anna"), toUserId = Id("carl") })))
            .StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task The_admin_list_and_detail_say_who_is_deactivated_and_list_what_a_creator_owns()
    {
        await Deactivate("anna");

        var detail = (await _admin.GetFromJsonAsync<AdminUserDetailDto>($"/admin/users/{Id("anna")}"))!;
        var list = (await _admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/admin/users?query=anna"))!;

        detail.DeactivatedAt.ShouldNotBeNull();
        detail.Boards.ShouldContain(b => b.Name == "Roadmap" && b.Role == "Owner");
        detail.Rooms.ShouldContain(r => r.Name == "Design team" && r.Role == "Owner");
        list.Items.Single().DeactivatedAt.ShouldNotBeNull();
    }

    // ---------------------------------------------------------------- the pickers

    [Test]
    public async Task A_deactivated_person_is_not_found_and_cannot_be_added_but_stays_in_the_member_list()
    {
        using var carl = Client("kc-carl");
        (await carl.GetFromJsonAsync<UserDto[]>("/users?query=dora"))!.ShouldHaveSingleItem();
        await Deactivate("dora");
        await Deactivate("bob");

        (await carl.GetFromJsonAsync<UserDto[]>("/users?query=dora"))!.ShouldBeEmpty();
        (await carl.PostAsync($"/boards/{_board.Id}/members",
                Json(new { email = "dora@example.com", role = "Viewer" })))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await carl.PostAsync($"/boards/{_board.Id}/members", Json(new { userId = Id("dora"), role = "Viewer" })))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var members = (await carl.GetFromJsonAsync<MemberDto[]>($"/boards/{_board.Id}/members"))!;
        members.Single(m => m.UserId == Id("bob")).IsDeactivated.ShouldBeTrue();
        members.Single(m => m.UserId == Id("carl")).IsDeactivated.ShouldBeFalse();
    }

    [Test]
    public async Task A_deactivated_person_cannot_be_added_to_a_local_group_but_can_be_taken_out()
    {
        var group = await (await _admin.PostAsync("/admin/groups", Json(new { name = "Staff" })))
            .Content.ReadFromJsonAsync<AdminGroupDto>();
        (await _admin.PutAsync($"/admin/groups/{group!.Id}/members/{Id("bob")}", null)).StatusCode
            .ShouldBe(HttpStatusCode.NoContent);
        await Deactivate("bob");
        await Deactivate("dora");

        (await _admin.PutAsync($"/admin/groups/{group.Id}/members/{Id("dora")}", null)).StatusCode
            .ShouldBe(HttpStatusCode.Conflict);
        (await _admin.DeleteAsync($"/admin/groups/{group.Id}/members/{Id("bob")}")).StatusCode
            .ShouldBe(HttpStatusCode.NoContent);
    }

    // ---------------------------------------------------------------- the hand-over

    [Test]
    public async Task A_hand_over_makes_the_receiver_the_owner_and_leaves_the_giver_nothing()
    {
        await Deactivate("anna");

        var response = await Transfer("anna", "dora");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var result = (await response.Content.ReadFromJsonAsync<AdminTransferResultDto>())!;
        result.Boards.ShouldBe(1);
        result.Rooms.ShouldBe(1);
        using var dora = Client("kc-dora");
        (await dora.GetFromJsonAsync<MembershipDto>($"/boards/{_board.Id}/membership/me"))!.Role.ShouldBe("Owner");
        (await dora.GetAsync($"/rooms/{_room.Id}/members")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _internal.GetAsync($"/internal/boards/{_board.Id}/access?sub=kc-anna")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        var board = await InDb(db => db.Boards.AsNoTracking().SingleAsync(b => b.Id == _board.Id));
        board.OwnerId.ShouldBe(Id("dora"));
        (await InDb(db => db.BoardMemberships.CountAsync(m => m.UserId == Id("anna")))).ShouldBe(0);
        var room = await InDb(db => db.Rooms.AsNoTracking().SingleAsync(r => r.Id == _room.Id));
        room.OwnerId.ShouldBe(Id("dora"));
    }

    [Test]
    public async Task A_receiver_who_was_a_member_becomes_the_owner_of_it()
    {
        await Deactivate("anna");

        await Transfer("anna", "bob");

        using var bob = Client("kc-bob");
        (await bob.GetFromJsonAsync<MembershipDto>($"/boards/{_board.Id}/membership/me"))!.Role.ShouldBe("Owner");
    }

    [Test]
    public async Task A_hand_over_of_an_owner_membership_moves_the_membership()
    {
        // Carl is an Owner by membership, not the creator.
        await Deactivate("carl");

        var response = await Transfer("carl", "dora");

        (await response.Content.ReadFromJsonAsync<AdminTransferResultDto>())!.Boards.ShouldBe(1);
        using var dora = Client("kc-dora");
        (await dora.GetFromJsonAsync<MembershipDto>($"/boards/{_board.Id}/membership/me"))!.Role.ShouldBe("Owner");
        (await InDb(db => db.BoardMemberships.CountAsync(m => m.UserId == Id("carl")))).ShouldBe(0);
    }

    [Test]
    public async Task The_administrator_gets_no_role_from_a_hand_over()
    {
        await Deactivate("anna");
        await Transfer("anna", "dora");

        (await _admin.GetAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _admin.GetAsync($"/boards/{_board.Id}/membership/me")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_hand_over_is_audited_per_board_and_room()
    {
        await Deactivate("anna");
        await Transfer("anna", "dora");

        var entries = await InDb(db =>
            db.AuditEntries.Where(e => e.Action == AuditActions.OwnerTransferred).ToListAsync());
        entries.Select(e => e.SubjectType).Order().ShouldBe(["board", "room"]);
        entries.Select(e => e.SubjectId).ShouldBe([_board.Id, _room.Id], ignoreOrder: true);
        entries.ShouldAllBe(e => e.Details!.Contains(Id("dora").ToString()));
    }

    [Test]
    public async Task A_hand_over_is_refused_for_an_active_giver_a_deactivated_or_same_receiver_and_unknown_people()
    {
        (await Transfer("anna", "dora")).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        await Deactivate("anna");
        await Deactivate("dora");
        (await Transfer("anna", "dora")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await Transfer("anna", "anna")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await _admin.PostAsync("/admin/boards/transfer",
                Json(new { fromUserId = Id("anna"), toUserId = Guid.NewGuid() })))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _admin.PostAsync("/admin/boards/transfer", Json(new { fromUserId = Guid.Empty, toUserId = Id("bob") })))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // Nothing moved.
        (await InDb(db => db.Boards.AsNoTracking().SingleAsync(b => b.Id == _board.Id))).OwnerId.ShouldBe(Id("anna"));
    }

    [Test]
    public async Task A_hand_over_of_a_person_who_owns_nothing_is_a_zero()
    {
        await Deactivate("dora");

        var response = await Transfer("dora", "bob");

        var result = (await response.Content.ReadFromJsonAsync<AdminTransferResultDto>())!;
        result.Boards.ShouldBe(0);
        result.Rooms.ShouldBe(0);
    }
}
