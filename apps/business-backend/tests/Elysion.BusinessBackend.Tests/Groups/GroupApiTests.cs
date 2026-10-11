using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Groups;

/// <summary>The group endpoints and their status codes.</summary>
public class GroupApiTests
{
    private ApiFactory _factory = null!;
    private Guid _design;
    private Guid _engineering;

    [SetUp]
    public void SetUp()
    {
        _factory = new ApiFactory();
        var now = new DateTimeOffset(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        var design = Api.Entities.Group.Create(Guid.CreateVersion7(), "Design team", now);
        var engineering = Api.Entities.Group.Linked(Guid.CreateVersion7(), "oid-eng", "Engineering", now);
        db.AddRange(design, engineering, Api.Entities.Group.Create(Guid.CreateVersion7(), "Brand design", now));
        db.SaveChanges();
        (_design, _engineering) = (design.Id, engineering.Id);
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private HttpClient As(string name, params string[] groups) =>
        _factory.CreateAuthenticatedClient(name,
        [
            new Claim("sub", name), new("email", $"{name}@example.com"), new("preferred_username", name),
            .. groups.Select(g => new Claim("groups", g))
        ]);

    private static async Task<T> Read<T>(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    [Test]
    public async Task Search_finds_groups_by_part_of_the_name_without_members()
    {
        var found = await Read<GroupDto[]>(await As("ada").GetAsync("/groups?query=DESIGN"));

        found.Select(g => (g.Name, g.Source)).ShouldBe([("Brand design", "Local"), ("Design team", "Local")]);
        (await As("ada").GetFromJsonAsync<GroupDto[]>("/groups?query=eng"))!.Single()
            .ShouldBe(new GroupDto(_engineering, "Engineering", "IdentityProvider"));
    }

    [TestCase("")]
    [TestCase("a")]
    [TestCase("%20%20x%20")]
    public async Task A_query_under_two_characters_is_a_400(string query) =>
        (await As("ada").GetAsync($"/groups?query={query}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

    [Test]
    public async Task A_missing_query_is_a_400() =>
        (await As("ada").GetAsync("/groups")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

    [Test]
    public async Task Search_returns_at_most_20_groups()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
            db.AddRange(Enumerable.Range(0, 30)
                .Select(i =>
                    Api.Entities.Group.Create(Guid.CreateVersion7(), $"Many {i:D2}", DateTimeOffset.UnixEpoch)));
            await db.SaveChangesAsync();
        }

        (await As("ada").GetFromJsonAsync<GroupDto[]>("/groups?query=many"))!.Length.ShouldBe(20);
    }

    [Test]
    public async Task Search_needs_a_login() =>
        (await _factory.CreateClient().GetAsync("/groups?query=de")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task My_groups_are_the_ones_of_the_token()
    {
        var ada = As("ada", "oid-eng", "oid-other");

        var mine = await Read<GroupDto[]>(await ada.GetAsync("/me/groups"));

        mine.Select(g => g.Name).ShouldBe(["Engineering", "oid-other"]);
        (await As("bea").GetFromJsonAsync<GroupDto[]>("/me/groups"))!.ShouldBeEmpty();
    }

    [Test]
    public async Task The_groups_of_a_room_are_listed_for_everybody_who_can_see_it_and_changed_by_its_owner()
    {
        var ada = As("ada");
        var bea = As("bea");
        await bea.GetAsync("/rooms");
        var room = await Read<RoomDto>(await ada.PostAsync("/rooms", Json(new { name = "R" })));
        await ada.PostAsync($"/rooms/{room.Id}/members", Json(new { email = "bea@example.com", role = "Viewer" }));

        var set = await ada.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { role = "editor" }));
        await ada.PutAsync($"/rooms/{room.Id}/groups/{_engineering}", Json(new { role = "Viewer" }));

        set.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await set.Content.ReadFromJsonAsync<RoomGroupDto>())!.ShouldBe(new RoomGroupDto(_design,
            "Design team",
            "Editor"));
        var listed = await Read<RoomGroupDto[]>(await bea.GetAsync($"/rooms/{room.Id}/groups"));
        listed.Select(g => (g.Name, g.Role)).ShouldBe([("Design team", "Editor"), ("Engineering", "Viewer")]);
    }

    [Test]
    public async Task Only_an_owner_of_the_room_changes_its_groups()
    {
        var ada = As("ada");
        var bea = As("bea");
        await bea.GetAsync("/rooms");
        var room = await Read<RoomDto>(await ada.PostAsync("/rooms", Json(new { name = "R" })));
        await ada.PostAsync($"/rooms/{room.Id}/members", Json(new { email = "bea@example.com", role = "Editor" }));
        await ada.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { role = "Viewer" }));

        (await bea.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { role = "Owner" }))).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
        (await bea.DeleteAsync($"/rooms/{room.Id}/groups/{_design}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task A_person_with_no_role_in_the_room_gets_404_for_all_three()
    {
        var room = await Read<RoomDto>(await As("ada").PostAsync("/rooms", Json(new { name = "R" })));
        var stranger = As("eve");

        (await stranger.GetAsync($"/rooms/{room.Id}/groups")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { role = "Viewer" }))).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        (await stranger.DeleteAsync($"/rooms/{room.Id}/groups/{_design}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task An_unknown_group_is_a_404_and_a_bad_role_a_400()
    {
        var ada = As("ada");
        var room = await Read<RoomDto>(await ada.PostAsync("/rooms", Json(new { name = "R" })));

        (await ada.PutAsync($"/rooms/{room.Id}/groups/{Guid.NewGuid()}", Json(new { role = "Viewer" }))).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        (await ada.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { role = "Boss" }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
        (await ada.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
        (await ada.DeleteAsync($"/rooms/{room.Id}/groups/{_design}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_unknown_room_is_a_404()
    {
        var ada = As("ada");

        (await ada.GetAsync($"/rooms/{Guid.NewGuid()}/groups")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Removing_a_role_gives_204_and_the_list_forgets_it()
    {
        var ada = As("ada");
        var room = await Read<RoomDto>(await ada.PostAsync("/rooms", Json(new { name = "R" })));
        await ada.PutAsync($"/rooms/{room.Id}/groups/{_design}", Json(new { role = "Viewer" }));

        (await ada.DeleteAsync($"/rooms/{room.Id}/groups/{_design}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await ada.GetFromJsonAsync<RoomGroupDto[]>($"/rooms/{room.Id}/groups"))!.ShouldBeEmpty();
    }
}
