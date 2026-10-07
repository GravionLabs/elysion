using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// One walk through a room with two people, through the real pipeline and with users made from their tokens, as in
/// production: what a room gives its members (ADR 0019), and what taking a board out of it, changing a role and
/// deleting the room take away again.
/// </summary>
public class RoomAccessTests
{
    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp() => _factory = new ApiFactory();

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private HttpClient As(string name) =>
        _factory.CreateAuthenticatedClient(
            name,
            [new Claim("sub", name), new("email", $"{name}@example.com"), new("preferred_username", name)]);

    private static async Task<T> Read<T>(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    [Test]
    public async Task A_board_in_a_room_is_for_its_members_with_the_role_of_the_room_until_it_leaves_or_the_room_goes()
    {
        var ada = As("ada");
        var bea = As("bea");
        // Users exist after their first request (just-in-time provisioning): Bea has to have logged in to be added.
        (await bea.GetAsync("/rooms")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Ada makes a room, invites Bea as a viewer, makes a board and puts it in the room.
        var room = await Read<RoomDto>(await ada.PostAsync("/rooms", Json(new { name = "Sprint planning" })));
        (await ada.PostAsync($"/rooms/{room.Id}/members", Json(new { email = "bea@example.com", role = "Viewer" })))
            .StatusCode.ShouldBe(HttpStatusCode.Created);
        var board = await Read<BoardDto>(await ada.PostAsync("/boards", Json(new { name = "Retro" })));
        board.RoomId.ShouldBeNull();

        // Before the board is in the room Bea knows nothing about it.
        (await bea.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var moved = await Read<BoardDto>(await ada.PutAsync($"/boards/{board.Id}/room",
            Json(new { roomId = room.Id })));
        moved.RoomId.ShouldBe(room.Id);

        // List and open: Bea sees the board, as a viewer. She may not rename it.
        (await bea.GetFromJsonAsync<BoardDto[]>("/boards"))!.Select(b => b.Name).ShouldBe(["Retro"]);
        (await bea.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await bea.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Viewer");
        (await bea.PatchAsync($"/boards/{board.Id}", Json(new { name = "Renamed" }))).StatusCode.ShouldBe(
            HttpStatusCode.Forbidden);

        // Ada makes her an editor in the room: the same board now takes her rename.
        var members = await Read<MemberDto[]>(await ada.GetAsync($"/rooms/{room.Id}/members"));
        var beaId = members.Single(m => m.DisplayName == "bea").UserId;
        (await ada.PatchAsync($"/rooms/{room.Id}/members/{beaId}", Json(new { role = "Editor" }))).StatusCode
            .ShouldBe(HttpStatusCode.OK);
        (await bea.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Editor");
        (await bea.PatchAsync($"/boards/{board.Id}", Json(new { name = "Retro Q3" }))).StatusCode.ShouldBe(
            HttpStatusCode.OK);
        // An editor does not delete the board or share it: that is for the board's owner.
        (await bea.DeleteAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await bea.GetAsync($"/boards/{board.Id}/members")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Out of the room: the access the room gave goes with it, Ada keeps her board.
        var removed =
            await Read<BoardDto>(await ada.PutAsync($"/boards/{board.Id}/room", Json(new { roomId = (Guid?)null })));
        removed.RoomId.ShouldBeNull();
        (await bea.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await bea.GetFromJsonAsync<BoardDto[]>("/boards"))!.ShouldBeEmpty();
        (await ada.GetFromJsonAsync<BoardDto[]>("/boards"))!.Single().Name.ShouldBe("Retro Q3");

        // Back in, and then the room is deleted: Bea loses the board again, Ada's board stays outside any room.
        await ada.PutAsync($"/boards/{board.Id}/room", Json(new { roomId = room.Id }));
        (await bea.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await bea.DeleteAsync($"/rooms/{room.Id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await ada.DeleteAsync($"/rooms/{room.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await bea.GetAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await bea.GetFromJsonAsync<RoomDto[]>("/rooms"))!.ShouldBeEmpty();
        var kept = await Read<BoardDto>(await ada.GetAsync($"/boards/{board.Id}"));
        (kept.Name, kept.RoomId).ShouldBe(("Retro Q3", null));
    }

    [Test]
    public async Task A_boards_own_membership_outlives_the_room()
    {
        var ada = As("ada");
        var bea = As("bea");
        await bea.GetAsync("/rooms");
        var room = await Read<RoomDto>(await ada.PostAsync("/rooms", Json(new { name = "Sprint" })));
        await ada.PostAsync($"/rooms/{room.Id}/members", Json(new { email = "bea@example.com", role = "Editor" }));
        var board = await Read<BoardDto>(await ada.PostAsync("/boards", Json(new { name = "Shared twice" })));
        await ada.PutAsync($"/boards/{board.Id}/room", Json(new { roomId = room.Id }));
        // Invited to the board itself as well, as a viewer: the room's Editor is the higher role while she is in it.
        await ada.PostAsync($"/boards/{board.Id}/members", Json(new { email = "bea@example.com", role = "Viewer" }));
        (await bea.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Editor");

        await ada.DeleteAsync($"/rooms/{room.Id}");

        (await bea.GetFromJsonAsync<MembershipDto>($"/boards/{board.Id}/membership/me"))!.Role.ShouldBe("Viewer");
        (await bea.GetFromJsonAsync<BoardDto[]>("/boards"))!.Select(b => b.Name).ShouldBe(["Shared twice"]);
    }
}
