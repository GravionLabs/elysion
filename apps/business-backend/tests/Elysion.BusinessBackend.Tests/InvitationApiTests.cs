using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Invitations;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>Invitation links of boards and rooms (#734): who makes them, what following one does and when it stops working.</summary>
public class InvitationApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private MutableTime _time = null!;
    private ApiFactory _factory = null!;
    private Board _board = null!;
    private Room _room = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _time = new MutableTime(Start);
        _factory = new ApiFactory(_time);
        foreach (var name in new[] { "owner", "editor", "viewer", "stranger" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Start);
        }

        _board = Board.Create(Guid.CreateVersion7(), "Retro", Start, _users["owner"].Id);
        _room = Room.Create(Guid.CreateVersion7(), "Team", Start, _users["owner"].Id);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(
            _board,
            _room,
            BoardMembership.Create(_board.Id, _users["editor"].Id, BoardRole.Editor, Start),
            BoardMembership.Create(_board.Id, _users["viewer"].Id, BoardRole.Viewer, Start),
            RoomMembership.Create(_room.Id, _users["editor"].Id, BoardRole.Editor, Start),
            RoomMembership.Create(_room.Id, _users["viewer"].Id, BoardRole.Viewer, Start));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private HttpClient As(string name) =>
        _factory.CreateAuthenticatedClient(name,
        [
            new System.Security.Claims.Claim("sub", name), new("email", $"{name}@example.com"),
            new("preferred_username", name),
        ]);

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private string BoardUrl(string tail = "") => $"/boards/{_board.Id}/invitations{tail}";

    private string RoomUrl(string tail = "") => $"/rooms/{_room.Id}/invitations{tail}";

    private static object Body(string role = "Viewer", int hours = 24, int? maxUses = null) =>
        new { role, expiresInHours = hours, maxUses };

    private async Task<CreatedInvitationDto> CreateAsync(string url, object? body = null, string actor = "owner")
    {
        var response = await As(actor).PostAsync(url, Json(body ?? Body()));
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<CreatedInvitationDto>())!;
    }

    private Task<HttpResponseMessage> AcceptAsync(string actor, string token) =>
        As(actor).PostAsync($"/invitations/{token}/accept", null);

    private async Task<string?> RoleOnBoardAsync(string name)
    {
        var response = await As(name).GetAsync($"/boards/{_board.Id}/membership/me");
        return response.StatusCode == HttpStatusCode.OK
            ? (await response.Content.ReadFromJsonAsync<MembershipDto>())!.Role
            : null;
    }

    [Test]
    public async Task Creating_a_link_shows_the_token_once_and_stores_only_its_hash()
    {
        var created = await CreateAsync(BoardUrl(), Body("Editor", 48, 5));

        created.Token.Length.ShouldBe(InvitationTokens.TokenLength);
        InvitationTokens.LooksValid(created.Token).ShouldBeTrue();
        created.Role.ShouldBe("Editor");
        created.ExpiresAt.ShouldBe(Start.AddHours(48));
        created.MaxUses.ShouldBe(5);
        created.Uses.ShouldBe(0);
        using var scope = _factory.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<ElysionDbContext>().Invitations.SingleAsync();
        stored.TokenHash.ShouldBe(InvitationTokens.Hash(created.Token));
        stored.TokenHash.ShouldNotContain(created.Token);
        stored.BoardId.ShouldBe(_board.Id);
        stored.RoomId.ShouldBeNull();
        stored.CreatedByUserId.ShouldBe(_users["owner"].Id);
    }

    [Test]
    public async Task The_list_has_the_active_links_without_their_token()
    {
        var created = await CreateAsync(BoardUrl());

        var response = await As("owner").GetAsync(BoardUrl());

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var text = await response.Content.ReadAsStringAsync();
        text.ShouldNotContain(created.Token);
        text.ShouldNotContain("token", Case.Insensitive);
        var list = JsonSerializer.Deserialize<InvitationDto[]>(text, JsonSerializerOptions.Web)!;
        list.Single().Id.ShouldBe(created.Id);
    }

    [TestCase("owner", HttpStatusCode.Created)]
    [TestCase("editor", HttpStatusCode.Forbidden)]
    [TestCase("viewer", HttpStatusCode.Forbidden)]
    [TestCase("stranger", HttpStatusCode.NotFound)]
    public async Task Only_an_owner_makes_lists_and_revokes_links(string actor, HttpStatusCode create)
    {
        (await As(actor).PostAsync(BoardUrl(), Json(Body()))).StatusCode.ShouldBe(create);
        (await As(actor).PostAsync(RoomUrl(), Json(Body()))).StatusCode.ShouldBe(create);
        var expected = create == HttpStatusCode.Created ? HttpStatusCode.OK : create;
        (await As(actor).GetAsync(BoardUrl())).StatusCode.ShouldBe(expected);
        (await As(actor).GetAsync(RoomUrl())).StatusCode.ShouldBe(expected);
        var revoke = create == HttpStatusCode.Created ? HttpStatusCode.NotFound : create;
        (await As(actor).DeleteAsync(BoardUrl($"/{Guid.NewGuid()}"))).StatusCode.ShouldBe(revoke);
    }

    [TestCase("Owner")]
    [TestCase("Admin")]
    [TestCase("")]
    public async Task A_link_gives_editor_or_viewer_only(string role) =>
        (await As("owner").PostAsync(BoardUrl(), Json(Body(role)))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

    [TestCase(0, null)]
    [TestCase(721, null)]
    [TestCase(24, 0)]
    [TestCase(24, 1001)]
    public async Task The_expiry_and_the_uses_have_limits(int hours, int? maxUses) =>
        (await As("owner").PostAsync(BoardUrl(), Json(Body("Viewer", hours, maxUses)))).StatusCode
        .ShouldBe(HttpStatusCode.BadRequest);

    [Test]
    public async Task A_board_has_at_most_fifty_active_links()
    {
        for (var i = 0; i < Invitation.MaxActivePerTarget; i++)
        {
            await CreateAsync(BoardUrl());
        }

        (await As("owner").PostAsync(BoardUrl(), Json(Body()))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        // The limit is per board or room.
        await CreateAsync(RoomUrl());
    }

    [Test]
    public async Task Following_a_board_link_makes_the_person_a_member_with_its_role_and_counts_the_use()
    {
        var link = await CreateAsync(BoardUrl(), Body("Editor"));

        var response = await AcceptAsync("stranger", link.Token);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var accepted = (await response.Content.ReadFromJsonAsync<AcceptedInvitationDto>())!;
        accepted.ShouldBe(new AcceptedInvitationDto("board", _board.Id, "Editor"));
        (await RoleOnBoardAsync("stranger")).ShouldBe("Editor");
        (await As("owner").GetFromJsonAsync<InvitationDto[]>(BoardUrl()))!.Single().Uses.ShouldBe(1);
    }

    [Test]
    public async Task Following_a_room_link_makes_the_person_a_member_of_the_room()
    {
        var link = await CreateAsync(RoomUrl(), Body("Viewer"));

        var accepted = (await (await AcceptAsync("stranger", link.Token)).Content
            .ReadFromJsonAsync<AcceptedInvitationDto>())!;

        accepted.ShouldBe(new AcceptedInvitationDto("room", _room.Id, "Viewer"));
        (await As("stranger").GetAsync($"/rooms/{_room.Id}/members")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        (await db.RoomMemberships.SingleAsync(m => m.RoomId == _room.Id && m.UserId != _users["editor"].Id
                                                                        && m.UserId != _users["viewer"].Id)).Role
            .ShouldBe(BoardRole.Viewer);
    }

    [Test]
    public async Task A_link_raises_a_lower_role_but_never_lowers_a_higher_one()
    {
        var editorLink = await CreateAsync(BoardUrl(), Body("Editor"));
        var viewerLink = await CreateAsync(BoardUrl(), Body("Viewer"));

        (await AcceptAsync("viewer", editorLink.Token)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await RoleOnBoardAsync("viewer")).ShouldBe("Editor");

        var kept = (await (await AcceptAsync("editor", viewerLink.Token)).Content
            .ReadFromJsonAsync<AcceptedInvitationDto>())!;
        kept.Role.ShouldBe("Editor");
        (await RoleOnBoardAsync("editor")).ShouldBe("Editor");
        var owner = (await (await AcceptAsync("owner", editorLink.Token)).Content
            .ReadFromJsonAsync<AcceptedInvitationDto>())!;
        owner.Role.ShouldBe("Owner");
    }

    [Test]
    public async Task A_use_is_counted_only_when_the_link_changed_something()
    {
        var link = await CreateAsync(BoardUrl(), Body("Viewer", 24, 1));

        // The editor has more than the link gives: nothing changes, the single use is not spent.
        (await AcceptAsync("editor", link.Token)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await As("owner").GetFromJsonAsync<InvitationDto[]>(BoardUrl()))!.Single().Uses.ShouldBe(0);

        (await AcceptAsync("stranger", link.Token)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await As("owner").GetFromJsonAsync<InvitationDto[]>(BoardUrl()))!.ShouldBeEmpty(); // used up
    }

    [Test]
    public async Task A_link_that_is_used_up_answers_410()
    {
        var link = await CreateAsync(BoardUrl(), Body("Viewer", 24, 1));
        await AcceptAsync("stranger", link.Token);
        using var other = _factory.CreateAuthenticatedClient("late");

        var response = await other.PostAsync($"/invitations/{link.Token}/accept", null);

        response.StatusCode.ShouldBe(HttpStatusCode.Gone);
    }

    [Test]
    public async Task A_link_that_expired_answers_410_and_is_not_listed()
    {
        var link = await CreateAsync(BoardUrl(), Body("Viewer", 1));
        _time.Now = Start.AddHours(1);

        (await AcceptAsync("stranger", link.Token)).StatusCode.ShouldBe(HttpStatusCode.Gone);
        (await As("owner").GetFromJsonAsync<InvitationDto[]>(BoardUrl()))!.ShouldBeEmpty();
        (await RoleOnBoardAsync("stranger")).ShouldBeNull();
    }

    [Test]
    public async Task A_revoked_link_answers_410_and_revoking_twice_is_fine()
    {
        var link = await CreateAsync(BoardUrl());

        (await As("owner").DeleteAsync(BoardUrl($"/{link.Id}"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await As("owner").DeleteAsync(BoardUrl($"/{link.Id}"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await AcceptAsync("stranger", link.Token)).StatusCode.ShouldBe(HttpStatusCode.Gone);
        (await As("owner").GetFromJsonAsync<InvitationDto[]>(BoardUrl()))!.ShouldBeEmpty();
    }

    [Test]
    public async Task A_link_of_a_room_cannot_be_revoked_through_a_board()
    {
        var link = await CreateAsync(RoomUrl());

        (await As("owner").DeleteAsync(BoardUrl($"/{link.Id}"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await AcceptAsync("stranger", link.Token)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [TestCase("not-a-token")]
    [TestCase("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    public async Task An_unknown_token_answers_404(string token) =>
        (await AcceptAsync("stranger", token)).StatusCode.ShouldBe(HttpStatusCode.NotFound);

    [Test]
    public async Task Following_a_link_needs_a_signed_in_person()
    {
        var link = await CreateAsync(BoardUrl());
        using var anonymous = _factory.CreateClient();

        (await anonymous.PostAsync($"/invitations/{link.Token}/accept", null)).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
    }
}
