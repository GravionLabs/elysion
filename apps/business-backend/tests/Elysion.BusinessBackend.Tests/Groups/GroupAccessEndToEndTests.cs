using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Groups;

/// <summary>
/// The access rule of ADR 0027 through the real pipeline, with users made from their tokens: a group that has a role in a room gives
/// its members that role on the room and its boards, next to what they have as people, and the highest one counts. Group
/// memberships come from the <c>groups</c> claim of the token (a linked group), so a token without it has no group access.
/// </summary>
public class GroupAccessEndToEndTests
{
    private const string Group = "11111111-aaaa-bbbb-cccc-000000000001";
    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp() => _factory = new ApiFactory();

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

    private async Task<Guid> GroupIdAsync(string externalId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        return (await db.Groups.SingleAsync(g => g.ExternalId == externalId)).Id;
    }

    /// <summary>Person two (P2) makes room R and board B in it; person one (P1) has logged in with the group G in the token.</summary>
    private async Task<(HttpClient P1, HttpClient P2, RoomDto Room, BoardDto Board, Guid GroupId)> SetUpAsync()
    {
        var p1 = As("p1", Group);
        var p2 = As("p2");
        (await p1.GetAsync("/rooms")).StatusCode
            .ShouldBe(HttpStatusCode.OK); // the group exists after the first request
        var room = await Read<RoomDto>(await p2.PostAsync("/rooms", Json(new { name = "Design" })));
        var board = await Read<BoardDto>(await p2.PostAsync("/boards", Json(new { name = "Retro" })));
        await p2.PutAsync($"/boards/{board.Id}/room", Json(new { roomId = room.Id }));
        return (p1, p2, room, board, await GroupIdAsync(Group));
    }

    [Test]
    public async Task
        A_member_of_a_group_with_the_role_Editor_on_a_room_lists_opens_and_edits_its_boards_but_does_not_delete_them()
    {
        var (p1, p2, room, board, groupId) = await SetUpAsync();
        (await p1.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound); // no role yet

        (await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Editor" }))).StatusCode
            .ShouldBe(HttpStatusCode.OK);

        (await p1.GetFromJsonAsync<BoardDto[]>("/boards"))!.Select(b => b.Name).ShouldBe(["Retro"]);
        (await p1.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await p1.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Editor");
        (await p1.GetFromJsonAsync<RoomDto[]>("/rooms"))!.Single().Name.ShouldBe("Design");
        (await p1.PatchAsync($"/boards/{board.Id}", Json(new { name = "Retro Q3" }))).StatusCode
            .ShouldBe(HttpStatusCode.OK);
        (await p1.DeleteAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task Lowering_the_role_of_the_group_lowers_the_role_of_its_members()
    {
        var (p1, p2, room, board, groupId) = await SetUpAsync();
        await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Editor" }));

        await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Viewer" }));

        (await p1.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Viewer");
        (await p1.PatchAsync($"/boards/{board.Id}", Json(new { name = "No" }))).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task Taking_the_group_out_of_the_room_takes_the_access_away()
    {
        var (p1, p2, room, board, groupId) = await SetUpAsync();
        await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Editor" }));

        (await p2.DeleteAsync($"/rooms/{room.Id}/groups/{groupId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await p1.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await p1.GetFromJsonAsync<BoardDto[]>("/boards"))!.ShouldBeEmpty();
        (await p1.GetFromJsonAsync<RoomDto[]>("/rooms"))!.ShouldBeEmpty();
    }

    [Test]
    public async Task A_token_without_the_group_has_no_access_through_it()
    {
        var (_, p2, room, board, groupId) = await SetUpAsync();
        await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Editor" }));
        var p1WithoutGroup = As("p1");

        (await p1WithoutGroup.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await p1WithoutGroup.GetFromJsonAsync<BoardDto[]>("/boards"))!.ShouldBeEmpty();
        // The membership followed the token: the person is out of the group now, and a later token with it brings it back.
        (await As("p1", Group).GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task A_direct_Owner_role_on_the_board_is_not_lowered_by_a_lower_role_of_the_group()
    {
        var p1 = As("p1", Group);
        var p2 = As("p2");
        await p1.GetAsync("/rooms");
        var room = await Read<RoomDto>(await p2.PostAsync("/rooms", Json(new { name = "Design" })));
        var board = await Read<BoardDto>(await p2.PostAsync("/boards", Json(new { name = "Retro" })));
        await p2.PutAsync($"/boards/{board.Id}/room", Json(new { roomId = room.Id }));
        await p2.PostAsync($"/boards/{board.Id}/members", Json(new { email = "p1@example.com", role = "Owner" }));
        await p2.PutAsync($"/rooms/{room.Id}/groups/{await GroupIdAsync(Group)}", Json(new { role = "Viewer" }));

        (await p1.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Owner");
        // And when the person leaves the group, the board role stays.
        (await As("p1").GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Owner");
    }

    [Test]
    public async Task The_highest_of_the_room_role_and_the_group_role_counts()
    {
        var (p1, p2, room, board, groupId) = await SetUpAsync();
        await p2.PostAsync($"/rooms/{room.Id}/members", Json(new { email = "p1@example.com", role = "Editor" }));

        await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Viewer" }));

        (await p1.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Editor");
    }

    [Test]
    public async Task Deleting_the_room_leaves_the_board_without_a_room_and_the_group_member_without_access()
    {
        var (p1, p2, room, board, groupId) = await SetUpAsync();
        await p2.PutAsync($"/rooms/{room.Id}/groups/{groupId}", Json(new { role = "Editor" }));

        (await p2.DeleteAsync($"/rooms/{room.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await p1.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await p2.GetFromJsonAsync<BoardDto>($"/boards/{board.Id}"))!.RoomId.ShouldBeNull();
        // That the rows of the room's group roles go with the room, and a group's roles with the group, is the database's cascade:
        // GroupRepositoryTests checks it on SQLite (the in-memory provider of this factory has no referential actions).
    }
}
