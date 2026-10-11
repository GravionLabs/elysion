using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Admin;

/// <summary>
/// The administration area (ADR 0027, #656): only for the holders of the realm role, metadata only, and no role on any board.
/// </summary>
public class AdminApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static readonly string[] OfflineAccess = ["offline_access"];
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private MutableTime _time = null!;
    private ApiFactory _factory = null!;
    private HttpClient _admin = null!;
    private HttpClient _user = null!;
    private readonly Dictionary<string, User> _users = [];
    private Room _room = null!;
    private Board _board = null!;

    [SetUp]
    public async Task SetUp()
    {
        _time = new MutableTime(Start);
        _factory = new ApiFactory(_time);
        _admin = Client("kc-admin", "elysion-admin");
        _user = Client("kc-user");

        foreach (var name in new[] { "anna", "bob", "carl" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), $"kc-{name}", name, $"{name}@example.com", Start);
        }

        _room = Room.Create(Guid.CreateVersion7(), "Design team", Start, _users["anna"].Id);
        _board = Board.Create(Guid.CreateVersion7(), "Secret roadmap", Start, _users["anna"].Id);
        _board.RoomId = _room.Id;
        var staff = Group.Create(Guid.CreateVersion7(), "Staff", Start);
        var linked = Group.Linked(Guid.CreateVersion7(), "11111111-0000-0000-0000-000000000001", "Engineering", Start);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(_room,
            _board,
            RoomMembership.Create(_room.Id, _users["anna"].Id, BoardRole.Owner, Start),
            RoomMembership.Create(_room.Id, _users["bob"].Id, BoardRole.Viewer, Start),
            BoardMembership.Create(_board.Id, _users["anna"].Id, BoardRole.Owner, Start),
            staff,
            linked,
            GroupMembership.Create(staff.Id, _users["anna"].Id, Start),
            GroupMembership.Create(staff.Id, _users["bob"].Id, Start),
            GroupMembership.Create(linked.Id, _users["carl"].Id, Start),
            RoomGroupMembership.Create(_room.Id, staff.Id, BoardRole.Editor, Start));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown()
    {
        _admin.Dispose();
        _user.Dispose();
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

    private static async Task<T> Read<T>(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    private async Task<T> InDb<T>(Func<ElysionDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    private Guid GroupId(string name) =>
        InDb(db => db.Groups.Where(g => g.Name == name).Select(g => g.Id).SingleAsync())
            .GetAwaiter()
            .GetResult();

    // ---------------------------------------------------------------- who may

    [TestCase("GET", "/admin/stats")]
    [TestCase("GET", "/admin/users")]
    [TestCase("GET", "/admin/users/00000000-0000-0000-0000-000000000001")]
    [TestCase("GET", "/admin/groups")]
    [TestCase("POST", "/admin/groups")]
    [TestCase("PATCH", "/admin/groups/00000000-0000-0000-0000-000000000001")]
    [TestCase("DELETE", "/admin/groups/00000000-0000-0000-0000-000000000001")]
    [TestCase("GET", "/admin/groups/00000000-0000-0000-0000-000000000001/members")]
    [TestCase("PUT", "/admin/groups/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002")]
    [TestCase("DELETE",
        "/admin/groups/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002")]
    [TestCase("GET", "/admin/groups/00000000-0000-0000-0000-000000000001/pending")]
    [TestCase("GET", "/admin/graph")]
    [TestCase("GET", "/admin/rooms")]
    public async Task Somebody_without_the_role_gets_403_everywhere(string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method is "POST" or "PATCH")
        {
            request.Content = Json(new { name = "x" });
        }

        (await _user.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task Another_realm_role_is_not_the_administrator_role()
    {
        using var client = Client("kc-other", "board-user");

        (await client.GetAsync("/admin/stats")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task Without_a_token_the_area_is_401()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync("/admin/stats")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task An_administrator_who_is_not_a_member_has_no_role_on_a_board_or_a_room()
    {
        (await _admin.GetAsync("/admin/stats")).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await _admin.GetAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _admin.GetAsync($"/boards/{_board.Id}/membership/me")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _admin.GetAsync($"/rooms/{_room.Id}/members")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await Read<BoardDto[]>(await _admin.GetAsync("/boards"))).ShouldBeEmpty();
        (await _admin.DeleteAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // ------------------------------------------------------------------ users

    [Test]
    public async Task The_user_list_is_paged_newest_first_with_the_groups_of_each_person()
    {
        _time.Now = Start.AddMinutes(1); // the administrator is made now, after the others
        var all = await Read<PagedResult<AdminUserDto>>(await _admin.GetAsync("/admin/users"));
        all.Total.ShouldBe(4); // anna, bob, carl and the administrator, made by their first request
        all.Page.ShouldBe(1);
        all.PageSize.ShouldBe(25);
        all.Items[0].DisplayName.ShouldBe("kc-admin");
        all.Items.Single(u => u.DisplayName == "anna").Groups.Select(g => g.Name).ShouldBe(["Staff"]);
        all.Items.Single(u => u.DisplayName == "carl").Groups.Select(g => g.Name).ShouldBe(["Engineering"]);

        var second = await Read<PagedResult<AdminUserDto>>(await _admin.GetAsync("/admin/users?page=2&pageSize=3"));
        second.Total.ShouldBe(4);
        second.Items.Count.ShouldBe(1);
    }

    [Test]
    public async Task The_user_list_is_searched_by_name_or_email_ignoring_case()
    {
        (await Read<PagedResult<AdminUserDto>>(await _admin.GetAsync("/admin/users?query=BOB")))
            .Items.Select(u => u.DisplayName)
            .ShouldBe(["bob"]);
        (await Read<PagedResult<AdminUserDto>>(await _admin.GetAsync("/admin/users?query=carl@example")))
            .Items.Select(u => u.DisplayName)
            .ShouldBe(["carl"]);
        (await Read<PagedResult<AdminUserDto>>(await _admin.GetAsync("/admin/users?query=nobody")))
            .Items.ShouldBeEmpty();
    }

    [TestCase("?pageSize=1000", 100)]
    [TestCase("?pageSize=0", 25)]
    [TestCase("?pageSize=-3&page=-1", 25)]
    public async Task The_page_size_is_kept_inside_what_the_area_serves(string query, int expected)
    {
        var result = await Read<PagedResult<AdminUserDto>>(await _admin.GetAsync($"/admin/users{query}"));

        result.PageSize.ShouldBe(expected);
        result.Page.ShouldBe(1);
    }

    [Test]
    public async Task A_person_is_shown_with_their_rooms_and_boards_by_name_and_role()
    {
        var detail = await Read<AdminUserDetailDto>(await _admin.GetAsync($"/admin/users/{_users["anna"].Id}"));

        detail.DisplayName.ShouldBe("anna");
        detail.Email.ShouldBe("anna@example.com");
        detail.Rooms.ShouldBe([new AdminMembershipDto(_room.Id, "Design team", "Owner")]);
        detail.Boards.ShouldBe([new AdminMembershipDto(_board.Id, "Secret roadmap", "Owner")]);
        detail.Groups.Select(g => g.Name).ShouldBe(["Staff"]);
    }

    [Test]
    public async Task An_unknown_person_is_404()
    {
        (await _admin.GetAsync($"/admin/users/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // -------------------------------------------------------------- LastSeenAt

    private Task<DateTimeOffset?> LastSeenAsync(string subject) =>
        InDb(db => db.Users.Where(u => u.Subject == subject).Select(u => u.LastSeenAt).SingleAsync());

    [Test]
    public async Task LastSeenAt_is_written_at_most_once_in_five_minutes()
    {
        await _user.GetAsync("/boards");
        (await LastSeenAsync("kc-user")).ShouldBe(Start);

        _time.Now = Start.AddMinutes(4);
        await _user.GetAsync("/boards");
        (await LastSeenAsync("kc-user")).ShouldBe(Start);

        _time.Now = Start.AddMinutes(5);
        await _user.GetAsync("/boards");
        (await LastSeenAsync("kc-user")).ShouldBe(Start.AddMinutes(5));
    }

    [Test]
    public async Task A_person_who_was_never_seen_gets_a_time_with_the_next_request()
    {
        (await LastSeenAsync("kc-anna")).ShouldBeNull();

        using var anna = Client("kc-anna");
        await anna.GetAsync("/boards");

        (await LastSeenAsync("kc-anna")).ShouldBe(Start);
    }

    // ----------------------------------------------------------------- groups

    [Test]
    public async Task The_group_list_has_the_source_the_external_id_and_the_counts()
    {
        var groups = (await Read<PagedResult<AdminGroupDto>>(await _admin.GetAsync("/admin/groups"))).Items;

        groups.Select(g => g.Name).ShouldBe(["Engineering", "Staff"]);
        var staff = groups.Single(g => g.Name == "Staff");
        staff.ShouldBe(new AdminGroupDto(staff.Id, "Staff", "Local", null, 2, 1));
        var engineering = groups.Single(g => g.Name == "Engineering");
        engineering.Source.ShouldBe("IdentityProvider");
        engineering.ExternalId.ShouldBe("11111111-0000-0000-0000-000000000001");
        engineering.MemberCount.ShouldBe(1);
        (await Read<PagedResult<AdminGroupDto>>(await _admin.GetAsync("/admin/groups?query=11111111")))
            .Items.Select(g => g.Name)
            .ShouldBe(["Engineering"]);
    }

    [Test]
    public async Task A_local_group_is_made_with_a_name()
    {
        var response = await _admin.PostAsync("/admin/groups", Json(new { name = "  Marketing " }));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var group = await Read<AdminGroupDto>(response);
        group.Name.ShouldBe("Marketing");
        group.Source.ShouldBe("Local");
        group.MemberCount.ShouldBe(0);
        response.Headers.Location!.ToString().ShouldBe($"/admin/groups/{group.Id}");
    }

    [TestCase("")]
    [TestCase("   ")]
    public async Task A_group_needs_a_name(string name)
    {
        (await _admin.PostAsync("/admin/groups", Json(new { name }))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.PostAsync("/admin/groups", Json(new { name = new string('x', 121) }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Both_kinds_of_group_can_be_renamed()
    {
        var staff = GroupId("Staff");
        var engineering = GroupId("Engineering");

        (await Read<AdminGroupDto>(await _admin.PatchAsync($"/admin/groups/{staff}", Json(new { name = "Everybody" }))))
            .Name.ShouldBe("Everybody");
        (await Read<AdminGroupDto>(await _admin.PatchAsync($"/admin/groups/{engineering}", Json(new { name = "Dev" }))))
            .Name.ShouldBe("Dev");
        (await _admin.PatchAsync($"/admin/groups/{staff}", Json(new { name = " " }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task A_patch_that_says_nothing_is_a_400_and_an_unknown_group_a_404()
    {
        var staff = GroupId("Staff");

        (await _admin.PatchAsync($"/admin/groups/{staff}", Json(new { }))).StatusCode.ShouldBe(
            HttpStatusCode.BadRequest);
        (await _admin.PatchAsync($"/admin/groups/{Guid.NewGuid()}", Json(new { name = "x" }))).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Linking_a_local_group_makes_it_a_linked_group_and_keeps_its_members_until_they_sign_in()
    {
        var staff = GroupId("Staff");

        var linked = await Read<AdminGroupDto>(await _admin.PatchAsync($"/admin/groups/{staff}",
            Json(new { externalId = "  22222222-0000-0000-0000-000000000002 " })));

        linked.Source.ShouldBe("IdentityProvider");
        linked.ExternalId.ShouldBe("22222222-0000-0000-0000-000000000002");
        linked.MemberCount.ShouldBe(2);

        // From then on the claim decides: anna signs in without the group in her token and is out of it.
        using var anna = Client("kc-anna");
        await anna.GetAsync("/boards");
        (await Read<PagedResult<AdminMemberDto>>(await _admin.GetAsync($"/admin/groups/{staff}/members")))
            .Items.Select(m => m.DisplayName)
            .ShouldBe(["bob"]);
    }

    [Test]
    public async Task An_external_id_that_another_group_has_is_a_409()
    {
        var staff = GroupId("Staff");

        var response = await _admin.PatchAsync($"/admin/groups/{staff}",
            Json(new { externalId = "11111111-0000-0000-0000-000000000001" }));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await InDb(db => db.Groups.Where(g => g.Id == staff).Select(g => g.Source).SingleAsync()))
            .ShouldBe(GroupSource.Local);
    }

    [Test]
    public async Task Linking_a_group_to_its_own_id_again_is_fine()
    {
        var engineering = GroupId("Engineering");

        (await _admin.PatchAsync($"/admin/groups/{engineering}",
                Json(new { externalId = "11111111-0000-0000-0000-000000000001" }))).StatusCode
            .ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task Unlinking_makes_the_group_local_and_keeps_its_members()
    {
        var engineering = GroupId("Engineering");

        var local = await Read<AdminGroupDto>(await _admin.PatchAsync($"/admin/groups/{engineering}",
            Json(new { externalId = (string?)null })));

        local.Source.ShouldBe("Local");
        local.ExternalId.ShouldBeNull();
        local.MemberCount.ShouldBe(1);
        // A token with the group claim no longer changes it.
        using var carl = Client("kc-carl");
        await carl.GetAsync("/boards");
        (await Read<PagedResult<AdminGroupDto>>(await _admin.GetAsync("/admin/groups?query=Engineering")))
            .Items.Single()
            .Source.ShouldBe("Local");
    }

    [Test]
    public async Task An_external_id_has_to_be_a_string_of_a_sensible_length()
    {
        var staff = GroupId("Staff");

        (await _admin.PatchAsync($"/admin/groups/{staff}", Json(new { externalId = 5 }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.PatchAsync($"/admin/groups/{staff}", Json(new { externalId = new string('x', 256) }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.PatchAsync($"/admin/groups/{staff}", Json(new { externalId = "" }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Deleting_a_group_takes_its_members_and_its_room_roles_with_it()
    {
        var staff = GroupId("Staff");

        (await _admin.DeleteAsync($"/admin/groups/{staff}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await InDb(db => db.Groups.AnyAsync(g => g.Id == staff))).ShouldBeFalse();
        (await _admin.DeleteAsync($"/admin/groups/{staff}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task The_members_of_a_group_are_listed_with_paging()
    {
        var staff = GroupId("Staff");

        var page = await Read<PagedResult<AdminMemberDto>>(
            await _admin.GetAsync($"/admin/groups/{staff}/members?pageSize=1"));

        page.Total.ShouldBe(2);
        page.Items.Select(m => m.DisplayName).ShouldBe(["anna"]);
        (await _admin.GetAsync($"/admin/groups/{Guid.NewGuid()}/members")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Members_are_added_to_and_removed_from_a_local_group()
    {
        var staff = GroupId("Staff");
        var carl = _users["carl"].Id;

        (await _admin.PutAsync($"/admin/groups/{staff}/members/{carl}", null)).StatusCode
            .ShouldBe(HttpStatusCode.NoContent);
        (await _admin.PutAsync($"/admin/groups/{staff}/members/{carl}", null)).StatusCode
            .ShouldBe(HttpStatusCode.NoContent); // again: nothing changes
        (await Read<PagedResult<AdminMemberDto>>(await _admin.GetAsync($"/admin/groups/{staff}/members")))
            .Total.ShouldBe(3);

        (await _admin.DeleteAsync($"/admin/groups/{staff}/members/{carl}")).StatusCode
            .ShouldBe(HttpStatusCode.NoContent);
        (await _admin.DeleteAsync($"/admin/groups/{staff}/members/{carl}")).StatusCode
            .ShouldBe(HttpStatusCode.NoContent);
        (await Read<PagedResult<AdminMemberDto>>(await _admin.GetAsync($"/admin/groups/{staff}/members")))
            .Total.ShouldBe(2);
    }

    [Test]
    public async Task The_members_of_a_linked_group_are_the_providers_to_change_409()
    {
        var engineering = GroupId("Engineering");
        var anna = _users["anna"].Id;

        var add = await _admin.PutAsync($"/admin/groups/{engineering}/members/{anna}", null);
        var remove = await _admin.DeleteAsync($"/admin/groups/{engineering}/members/{_users["carl"].Id}");

        add.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        remove.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await add.Content.ReadAsStringAsync()).ShouldContain("identity provider");
    }

    [Test]
    public async Task An_unknown_group_or_person_is_404_when_editing_members()
    {
        var staff = GroupId("Staff");

        (await _admin.PutAsync($"/admin/groups/{Guid.NewGuid()}/members/{_users["carl"].Id}", null)).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        (await _admin.PutAsync($"/admin/groups/{staff}/members/{Guid.NewGuid()}", null)).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        (await _admin.DeleteAsync($"/admin/groups/{staff}/members/{Guid.NewGuid()}")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    // ------------------------------------------------------------------ rooms

    [Test]
    public async Task A_room_is_listed_by_its_metadata_and_nothing_of_its_boards_but_their_number()
    {
        var response = await _admin.GetAsync("/admin/rooms");
        var text = await response.Content.ReadAsStringAsync();
        var rooms = JsonSerializer.Deserialize<PagedResult<AdminRoomDto>>(text, Web)!;

        var room = rooms.Items.Single();
        room.Name.ShouldBe("Design team");
        room.Owner.ShouldBe(new AdminOwnerDto(_users["anna"].Id, "anna"));
        room.MemberCount.ShouldBe(2);
        room.GroupCount.ShouldBe(1);
        room.BoardCount.ShouldBe(1);
        text.ShouldNotContain("Secret roadmap");
        (await Read<PagedResult<AdminRoomDto>>(await _admin.GetAsync("/admin/rooms?query=design"))).Total.ShouldBe(1);
        (await Read<PagedResult<AdminRoomDto>>(await _admin.GetAsync("/admin/rooms?query=zzz"))).Total.ShouldBe(0);
    }

    // ------------------------------------------------------------------ stats

    [Test]
    public async Task The_numbers_count_the_instance_and_the_people_seen_in_30_days()
    {
        await _admin.GetAsync("/admin/stats"); // the administrator is seen now
        _time.Now = Start.AddDays(31);
        await _user.GetAsync("/boards"); // and a user, 31 days later

        var stats = await Read<AdminStatsDto>(await _admin.GetAsync("/admin/stats"));

        stats.Users.ShouldBe(5); // anna, bob, carl, the administrator and the user
        stats.UsersSeenLast30Days.ShouldBe(2); // the administrator (refreshed by this request) and the user
        stats.Groups.ShouldBe(2);
        stats.Rooms.ShouldBe(1);
        stats.Boards.ShouldBe(1);
    }
}
