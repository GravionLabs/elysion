using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The member API through the real pipeline: who may use it, and the rules of the member list.</summary>
public class BoardMembersApiTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private Board _board = null!;
    private Board _implicitBoard = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        foreach (var name in new[] { "owner", "coowner", "editor", "viewer", "invitee", "stranger" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Now);
        }

        _board = Board.Create(Guid.CreateVersion7(), "Retro", Now, _users["owner"].Id);
        _implicitBoard =
            Board.Create(Guid.CreateVersion7(),
                "Implicit",
                Now,
                _users["owner"].Id); // creator without a membership row
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(
            _board,
            _implicitBoard,
            BoardMembership.Create(_board.Id, _users["owner"].Id, BoardRole.Owner, Now),
            BoardMembership.Create(_board.Id, _users["coowner"].Id, BoardRole.Owner, Now.AddMinutes(1)),
            BoardMembership.Create(_board.Id, _users["editor"].Id, BoardRole.Editor, Now.AddMinutes(2)),
            BoardMembership.Create(_board.Id, _users["viewer"].Id, BoardRole.Viewer, Now.AddMinutes(3)));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private string Url(Guid? board = null, Guid? user = null) =>
        $"/boards/{board ?? _board.Id}/members{(user is null ? "" : $"/{user}")}";

    /// <summary>A client signed in as the user, with the name and email the seeded user has (provisioning keeps them in step with the token).</summary>
    private HttpClient As(string name) =>
        _factory.CreateAuthenticatedClient(
            name,
            [
                new System.Security.Claims.Claim("sub", name), new("email", $"{name}@example.com"),
                new("preferred_username", name)
            ]);

    private static async Task<string> ProblemDetailAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString()!;

    [TestCase("owner", HttpStatusCode.OK)]
    [TestCase("coowner", HttpStatusCode.OK)]
    [TestCase("editor", HttpStatusCode.Forbidden)]
    [TestCase("viewer", HttpStatusCode.Forbidden)]
    [TestCase("stranger", HttpStatusCode.NotFound)]
    public async Task Only_an_owner_may_use_the_member_api_on_every_endpoint(string actor, HttpStatusCode allowed)
    {
        using var client = As(actor);
        var target = _users["editor"].Id;
        var expectOk = allowed == HttpStatusCode.OK;

        (await client.GetAsync(Url())).StatusCode.ShouldBe(allowed, "list");
        (await client.PostAsync(Url(), Json(new { email = "invitee@example.com", role = "Viewer" }))).StatusCode
            .ShouldBe(expectOk ? HttpStatusCode.Created : allowed, "add");
        (await client.PatchAsync(Url(user: target), Json(new { role = "Viewer" }))).StatusCode.ShouldBe(allowed,
            "change role");
        (await client.DeleteAsync(Url(user: target))).StatusCode.ShouldBe(expectOk ? HttpStatusCode.NoContent : allowed,
            "remove");
    }

    [Test]
    public async Task Without_a_token_nothing_is_allowed()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync(Url())).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.DeleteAsync(Url(user: _users["viewer"].Id))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task The_list_shows_every_member_with_name_email_and_role()
    {
        using var client = As("owner");

        var members = (await client.GetFromJsonAsync<MemberDto[]>(Url()))!;

        members.Select(m => (m.DisplayName, m.Email, m.Role))
            .ShouldBe(
            [
                ("owner", "owner@example.com", "Owner"),
                ("coowner", "coowner@example.com", "Owner"),
                ("editor", "editor@example.com", "Editor"),
                ("viewer", "viewer@example.com", "Viewer"),
            ]);
    }

    [Test]
    public async Task The_list_shows_the_creator_as_owner_even_without_a_membership_row()
    {
        using var client = As("owner");

        var members = (await client.GetFromJsonAsync<MemberDto[]>(Url(_implicitBoard.Id)))!;

        members.ShouldHaveSingleItem()
            .ShouldBe(new MemberDto(_users["owner"].Id, "owner", "owner@example.com", "Owner"));
    }

    [Test]
    public async Task Adding_by_email_makes_the_person_a_member_with_that_role_whatever_the_case_of_the_email()
    {
        using var owner = As("owner");

        var response = await owner.PostAsync(Url(), Json(new { email = "  Invitee@Example.COM ", role = "editor" }));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var member = (await response.Content.ReadFromJsonAsync<MemberDto>())!;
        (member.UserId, member.Role).ShouldBe((_users["invitee"].Id, "Editor"));
        using var invitee = As("invitee");
        (await invitee.GetFromJsonAsync<MembershipDto>($"/boards/{_board.Id}/membership/me"))!.Role.ShouldBe("Editor");
        (await invitee.GetAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task Adding_an_unknown_email_is_a_404_with_a_clear_message_not_a_500()
    {
        using var owner = As("owner");

        var response = await owner.PostAsync(Url(), Json(new { email = "nobody@example.com", role = "Viewer" }));

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ProblemDetailAsync(response)).ShouldContain("logged in");
    }

    [Test]
    public async Task Adding_somebody_who_is_a_member_already_is_a_409_also_for_the_creator_without_a_row()
    {
        using var owner = As("owner");

        var member = await owner.PostAsync(Url(), Json(new { email = "viewer@example.com", role = "Editor" }));
        var creator = await owner.PostAsync(Url(_implicitBoard.Id),
            Json(new { email = "owner@example.com", role = "Viewer" }));

        member.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        creator.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [TestCase(null, "Viewer", "email")]
    [TestCase("", "Viewer", "email")]
    [TestCase("invitee@example.com", null, "role")]
    [TestCase("invitee@example.com", "Admin", "role")]
    [TestCase("invitee@example.com", "1", "role")]
    [TestCase("invitee@example.com", "7", "role")]
    public async Task Adding_with_a_missing_email_or_an_invalid_role_is_a_400_naming_the_field(string? email,
        string? role,
        string field)
    {
        using var owner = As("owner");

        var response = await owner.PostAsync(Url(), Json(new { email, role }));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")
            .TryGetProperty(field, out _)
            .ShouldBeTrue();
    }

    [Test]
    public async Task A_body_that_is_not_json_is_a_415()
    {
        using var owner = As("owner");

        var response = await owner.PostAsync(Url(), new StringContent("email=x", Encoding.UTF8, "text/plain"));

        response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
    }

    [Test]
    public async Task Changing_a_role_takes_effect_at_once()
    {
        using var owner = As("owner");
        using var editor = As("editor");
        (await editor.PatchAsync($"/boards/{_board.Id}", Json(new { name = "Renamed" }))).StatusCode.ShouldBe(
            HttpStatusCode.OK);

        var response = await owner.PatchAsync(Url(user: _users["editor"].Id), Json(new { role = "Viewer" }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<MemberDto>())!.Role.ShouldBe("Viewer");
        (await editor.PatchAsync($"/boards/{_board.Id}", Json(new { name = "Again" }))).StatusCode.ShouldBe(
            HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task Changing_the_role_of_somebody_who_is_no_member_is_a_404_and_an_invalid_role_a_400()
    {
        using var owner = As("owner");

        (await owner.PatchAsync(Url(user: _users["stranger"].Id), Json(new { role = "Viewer" }))).StatusCode.ShouldBe(
            HttpStatusCode.NotFound);
        (await owner.PatchAsync(Url(user: _users["editor"].Id), Json(new { role = "boss" }))).StatusCode.ShouldBe(
            HttpStatusCode.BadRequest);
        (await owner.PatchAsync(Url(user: _users["editor"].Id), Json(new { }))).StatusCode.ShouldBe(HttpStatusCode
            .BadRequest);
    }

    [Test]
    public async Task The_creator_cannot_be_demoted_or_removed_even_by_another_owner()
    {
        using var coowner = As("coowner");
        var creator = _users["owner"].Id;

        var demote = await coowner.PatchAsync(Url(user: creator), Json(new { role = "Viewer" }));
        var remove = await coowner.DeleteAsync(Url(user: creator));

        demote.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        remove.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ProblemDetailAsync(remove)).ShouldContain("creator");
        using var owner = As("owner");
        (await owner.DeleteAsync($"/boards/{_board.Id}")).StatusCode
            .ShouldBe(HttpStatusCode.NoContent); // still an owner
    }

    [Test]
    public async Task Another_owner_can_be_demoted_and_removed_while_the_creator_remains()
    {
        using var owner = As("owner");

        (await owner.PatchAsync(Url(user: _users["coowner"].Id), Json(new { role = "Editor" }))).StatusCode.ShouldBe(
            HttpStatusCode.OK);
        (await owner.PatchAsync(Url(user: _users["coowner"].Id), Json(new { role = "Owner" }))).StatusCode.ShouldBe(
            HttpStatusCode.OK);
        (await owner.DeleteAsync(Url(user: _users["coowner"].Id))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task Removing_a_member_takes_their_access_away_and_removing_a_non_member_is_a_404()
    {
        using var owner = As("owner");
        using var viewer = As("viewer");
        (await viewer.GetAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await owner.DeleteAsync(Url(user: _users["viewer"].Id))).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await viewer.GetAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await owner.DeleteAsync(Url(user: _users["viewer"].Id))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_member_of_one_board_cannot_manage_another_boards_members()
    {
        using var owner = As("owner");
        var otherBoard = Board.Create(Guid.CreateVersion7(), "Other", Now, _users["stranger"].Id);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
            db.Add(otherBoard);
            await db.SaveChangesAsync();
        }

        (await owner.GetAsync(Url(otherBoard.Id))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await owner.PostAsync(Url(otherBoard.Id), Json(new { email = "invitee@example.com", role = "Viewer" })))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
