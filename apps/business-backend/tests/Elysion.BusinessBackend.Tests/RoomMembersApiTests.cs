using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The room member API: owners only, and the rules of the board member API.</summary>
public class RoomMembersApiTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private Room _room = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        foreach (var name in new[] { "owner", "coowner", "editor", "viewer", "invitee", "stranger" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Now);
        }

        // The creator has no membership row: they are an Owner anyway.
        _room = Room.Create(Guid.CreateVersion7(), "Sprint planning", Now, _users["owner"].Id);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(
            _room,
            RoomMembership.Create(_room.Id, _users["coowner"].Id, BoardRole.Owner, Now.AddMinutes(1)),
            RoomMembership.Create(_room.Id, _users["editor"].Id, BoardRole.Editor, Now.AddMinutes(2)),
            RoomMembership.Create(_room.Id, _users["viewer"].Id, BoardRole.Viewer, Now.AddMinutes(3)));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private string Url(Guid? user = null) => $"/rooms/{_room.Id}/members{(user is null ? "" : $"/{user}")}";

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
    public async Task Only_an_owner_may_list_the_members(string actor, HttpStatusCode expected) =>
        (await As(actor).GetAsync(Url())).StatusCode.ShouldBe(expected);

    [TestCase("editor", HttpStatusCode.Forbidden)]
    [TestCase("viewer", HttpStatusCode.Forbidden)]
    [TestCase("stranger", HttpStatusCode.NotFound)]
    public async Task Only_an_owner_may_change_the_members(string actor, HttpStatusCode expected)
    {
        var client = As(actor);

        (await client.PostAsync(Url(), Json(new { email = "invitee@example.com", role = "Viewer" }))).StatusCode
            .ShouldBe(expected);
        (await client.PatchAsync(Url(_users["viewer"].Id), Json(new { role = "Editor" }))).StatusCode
            .ShouldBe(expected);
        (await client.DeleteAsync(Url(_users["viewer"].Id))).StatusCode.ShouldBe(expected);
    }

    [Test]
    public async Task Needs_a_signed_in_user() =>
        (await _factory.CreateClient().GetAsync(Url())).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task Lists_the_creator_first_even_without_a_membership_row_then_the_others_in_order()
    {
        var members = await As("owner").GetFromJsonAsync<MemberDto[]>(Url());

        members!.Select(m => (m.DisplayName, m.Role))
            .ShouldBe(
                [("owner", "Owner"), ("coowner", "Owner"), ("editor", "Editor"), ("viewer", "Viewer")]);
    }

    [Test]
    public async Task Adds_a_user_by_email_with_201_and_a_location()
    {
        var response = await As("owner").PostAsync(Url(), Json(new { email = "invitee@example.com", role = "editor" }));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var member = (await response.Content.ReadFromJsonAsync<MemberDto>())!;
        (member.DisplayName, member.Role).ShouldBe(("invitee", "Editor"));
        response.Headers.Location!.OriginalString.ShouldBe($"/rooms/{_room.Id}/members/{member.UserId}");
        (await As("invitee").GetFromJsonAsync<RoomDto[]>("/rooms"))!.Single().Role.ShouldBe("Editor");
    }

    [Test]
    public async Task Refuses_a_missing_email_and_an_invalid_role_with_400()
    {
        var response = await As("owner").PostAsync(Url(), Json(new { email = " ", role = "Boss" }));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        errors.TryGetProperty("email", out _).ShouldBeTrue();
        errors.TryGetProperty("role", out _).ShouldBeTrue();
    }

    [Test]
    public async Task Says_why_an_email_cannot_be_added()
    {
        var unknown = await As("owner").PostAsync(Url(), Json(new { email = "nobody@example.com", role = "Viewer" }));
        var already = await As("owner").PostAsync(Url(), Json(new { email = "viewer@example.com", role = "Viewer" }));
        var creator = await As("owner").PostAsync(Url(), Json(new { email = "owner@example.com", role = "Viewer" }));

        unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ProblemDetailAsync(unknown)).ShouldContain("logged in");
        already.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ProblemDetailAsync(already)).ShouldContain("member of the room already");
        creator.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task Changes_a_role()
    {
        var response = await As("owner").PatchAsync(Url(_users["viewer"].Id), Json(new { role = "Editor" }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<MemberDto>())!.Role.ShouldBe("Editor");
        (await As("viewer").GetFromJsonAsync<RoomDto[]>("/rooms"))!.Single().Role.ShouldBe("Editor");
    }

    [Test]
    public async Task The_creator_stays_owner_and_the_last_owner_stays()
    {
        var creator = await As("coowner").PatchAsync(Url(_users["owner"].Id), Json(new { role = "Viewer" }));
        var demoteCoowner = await As("owner").PatchAsync(Url(_users["coowner"].Id), Json(new { role = "Viewer" }));
        var removeCreator = await As("owner").DeleteAsync(Url(_users["owner"].Id));

        creator.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ProblemDetailAsync(creator)).ShouldContain("creator of a room");
        // The creator counts as an owner, so the second owner may be demoted: the room keeps an owner.
        demoteCoowner.StatusCode.ShouldBe(HttpStatusCode.OK);
        removeCreator.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task Removes_a_member_and_answers_404_for_somebody_who_is_none()
    {
        var removed = await As("owner").DeleteAsync(Url(_users["viewer"].Id));
        var again = await As("owner").DeleteAsync(Url(_users["viewer"].Id));

        removed.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        again.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ProblemDetailAsync(again)).ShouldContain("not a member of the room");
        (await As("viewer").GetFromJsonAsync<RoomDto[]>("/rooms"))!.ShouldBeEmpty();
    }
}
