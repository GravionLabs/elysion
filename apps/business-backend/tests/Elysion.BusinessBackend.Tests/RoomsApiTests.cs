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

/// <summary>The room API through the real pipeline: who may do what, and what comes back.</summary>
public class RoomsApiTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private Room _room = null!;
    private Board _boardInRoom = null!;
    private Board _ownBoard = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        foreach (var name in new[] { "owner", "editor", "viewer", "stranger" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Now);
        }

        _room = Room.Create(Guid.CreateVersion7(), "Sprint planning", Now, _users["owner"].Id);
        _boardInRoom = Board.Create(Guid.CreateVersion7(), "In the room", Now, _users["owner"].Id);
        _boardInRoom.RoomId = _room.Id;
        _ownBoard = Board.Create(Guid.CreateVersion7(), "Own board", Now, _users["editor"].Id);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(
            _room,
            _boardInRoom,
            _ownBoard,
            RoomMembership.Create(_room.Id, _users["owner"].Id, BoardRole.Owner, Now),
            RoomMembership.Create(_room.Id, _users["editor"].Id, BoardRole.Editor, Now.AddMinutes(1)),
            RoomMembership.Create(_room.Id, _users["viewer"].Id, BoardRole.Viewer, Now.AddMinutes(2)));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private static StringContent Json(object? body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private HttpClient As(string name) =>
        _factory.CreateAuthenticatedClient(
            name,
            [
                new System.Security.Claims.Claim("sub", name), new("email", $"{name}@example.com"),
                new("preferred_username", name)
            ]);

    private async Task<T> InDbAsync<T>(Func<ElysionDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    public class Listing : RoomsApiTests
    {
        [Test]
        public async Task Lists_the_rooms_of_the_caller_with_their_role_and_no_others()
        {
            var otherRoom = Room.Create(Guid.CreateVersion7(), "Secret", Now, _users["stranger"].Id);
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
                db.Add(otherRoom);
                await db.SaveChangesAsync();
            }

            var asEditor = await As("editor").GetFromJsonAsync<RoomDto[]>("/rooms");
            var asStranger = await As("stranger").GetFromJsonAsync<RoomDto[]>("/rooms");

            asEditor!.Select(r => (r.Name, r.Role)).ShouldBe([("Sprint planning", "Editor")]);
            asStranger!.Select(r => (r.Name, r.Role)).ShouldBe([("Secret", "Owner")]);
        }

        [Test]
        public async Task Needs_a_signed_in_user() =>
            (await _factory.CreateClient().GetAsync("/rooms")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        [Test]
        public async Task The_board_list_carries_the_room_of_each_board()
        {
            var boards = await As("owner").GetFromJsonAsync<BoardDto[]>("/boards");

            boards!.Single(b => b.Id == _boardInRoom.Id).RoomId.ShouldBe(_room.Id);
        }
    }

    public class Creating : RoomsApiTests
    {
        [Test]
        public async Task Makes_the_caller_the_owner_and_answers_201_with_a_location()
        {
            var response = await As("stranger").PostAsync("/rooms", Json(new { name = "  Workshops  " }));

            response.StatusCode.ShouldBe(HttpStatusCode.Created);
            var room = (await response.Content.ReadFromJsonAsync<RoomDto>())!;
            room.Name.ShouldBe("Workshops");
            room.Role.ShouldBe("Owner");
            response.Headers.Location!.AbsolutePath.ShouldBe($"/rooms/{room.Id}");
            var stored = await InDbAsync(db => db.Rooms.Include(r => r.Memberships).SingleAsync(r => r.Id == room.Id));
            stored.OwnerId.ShouldBe(_users["stranger"].Id);
            stored.Memberships.Select(m => (m.UserId, m.Role)).ShouldBe([(_users["stranger"].Id, BoardRole.Owner)]);
        }

        [TestCase("")]
        [TestCase("   ")]
        public async Task Refuses_a_blank_name_with_400(string name)
        {
            var response = await As("owner").PostAsync("/rooms", Json(new { name }));

            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }

        [Test]
        public async Task Refuses_a_name_over_the_limit_with_400()
        {
            var response = await As("owner").PostAsync("/rooms", Json(new { name = new string('x', 121) }));

            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }

        [Test]
        public async Task Refuses_a_body_that_is_not_json_with_415()
        {
            var response = await As("owner").PostAsync("/rooms", new StringContent("name=x"));

            response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
        }

        [Test]
        public async Task Needs_a_signed_in_user() =>
            (await _factory.CreateClient().PostAsync("/rooms", Json(new { name = "x" }))).StatusCode.ShouldBe(
                HttpStatusCode.Unauthorized);
    }

    public class Renaming : RoomsApiTests
    {
        [TestCase("owner", HttpStatusCode.OK)]
        [TestCase("editor", HttpStatusCode.OK)]
        [TestCase("viewer", HttpStatusCode.Forbidden)]
        [TestCase("stranger", HttpStatusCode.NotFound)]
        public async Task Needs_editor_in_the_room(string actor, HttpStatusCode expected)
        {
            var response = await As(actor).PatchAsync($"/rooms/{_room.Id}", Json(new { name = "Renamed" }));

            response.StatusCode.ShouldBe(expected);
            var name = await InDbAsync(db => db.Rooms.Where(r => r.Id == _room.Id).Select(r => r.Name).SingleAsync());
            name.ShouldBe(expected == HttpStatusCode.OK ? "Renamed" : "Sprint planning");
        }

        [Test]
        public async Task Answers_the_room_with_the_trimmed_name_and_the_callers_role()
        {
            var response = await As("editor").PatchAsync($"/rooms/{_room.Id}", Json(new { name = "  New  " }));

            var room = (await response.Content.ReadFromJsonAsync<RoomDto>())!;
            (room.Name, room.Role).ShouldBe(("New", "Editor"));
        }

        [Test]
        public async Task Refuses_a_blank_name_with_400() =>
            (await As("owner").PatchAsync($"/rooms/{_room.Id}", Json(new { name = " " }))).StatusCode.ShouldBe(
                HttpStatusCode.BadRequest);

        [Test]
        public async Task An_unknown_room_is_404() =>
            (await As("owner").PatchAsync($"/rooms/{Guid.NewGuid()}", Json(new { name = "x" }))).StatusCode.ShouldBe(
                HttpStatusCode.NotFound);

        [Test]
        public async Task Needs_a_signed_in_user() =>
            (await _factory.CreateClient().PatchAsync($"/rooms/{_room.Id}", Json(new { name = "x" }))).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
    }

    public class Deleting : RoomsApiTests
    {
        [TestCase("editor", HttpStatusCode.Forbidden)]
        [TestCase("viewer", HttpStatusCode.Forbidden)]
        [TestCase("stranger", HttpStatusCode.NotFound)]
        public async Task Is_for_the_owner_only(string actor, HttpStatusCode expected)
        {
            var response = await As(actor).DeleteAsync($"/rooms/{_room.Id}");

            response.StatusCode.ShouldBe(expected);
            (await InDbAsync(db => db.Rooms.AnyAsync(r => r.Id == _room.Id))).ShouldBeTrue();
        }

        [Test]
        public async Task
            Removes_the_room_but_keeps_its_boards() // the memberships go by the database (RoomRepositoryTests)
        {
            var response = await As("owner").DeleteAsync($"/rooms/{_room.Id}");

            response.StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await InDbAsync(db => db.Rooms.AnyAsync())).ShouldBeFalse();
            var board = await InDbAsync(db => db.Boards.SingleAsync(b => b.Id == _boardInRoom.Id));
            board.RoomId.ShouldBeNull();
        }

        [Test]
        public async Task An_unknown_room_is_404() =>
            (await As("owner").DeleteAsync($"/rooms/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        [Test]
        public async Task Needs_a_signed_in_user() =>
            (await _factory.CreateClient().DeleteAsync($"/rooms/{_room.Id}")).StatusCode.ShouldBe(
                HttpStatusCode.Unauthorized);
    }

    public class Moving : RoomsApiTests
    {
        private Task<HttpResponseMessage> Move(string actor, Guid board, Guid? room) =>
            As(actor).PutAsync($"/boards/{board}/room", Json(new { roomId = room }));

        [Test]
        public async Task Puts_a_board_of_the_caller_into_a_room_where_they_are_an_editor()
        {
            var response = await Move("editor", _ownBoard.Id, _room.Id);

            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<BoardDto>())!.RoomId.ShouldBe(_room.Id);
            (await InDbAsync(db => db.Boards.SingleAsync(b => b.Id == _ownBoard.Id))).RoomId.ShouldBe(_room.Id);
        }

        [Test]
        public async Task Takes_a_board_out_of_its_room_with_a_null_room()
        {
            var response = await Move("owner", _boardInRoom.Id, null);

            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<BoardDto>())!.RoomId.ShouldBeNull();
            (await InDbAsync(db => db.Boards.SingleAsync(b => b.Id == _boardInRoom.Id))).RoomId.ShouldBeNull();
        }

        [Test]
        public async Task A_viewer_of_the_room_may_not_put_boards_in_it()
        {
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
                db.Add(Board.Create(Guid.CreateVersion7(), "Viewer's board", Now, _users["viewer"].Id));
                await db.SaveChangesAsync();
            }

            var boardId = await InDbAsync(db => db.Boards.Where(b => b.Name == "Viewer's board")
                .Select(b => b.Id)
                .SingleAsync());
            var response = await Move("viewer", boardId, _room.Id);

            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await InDbAsync(db => db.Boards.SingleAsync(b => b.Id == boardId))).RoomId.ShouldBeNull();
        }

        [Test]
        public async Task A_room_the_caller_has_no_role_in_does_not_exist_for_them()
        {
            var response = await Move("editor", _ownBoard.Id, Guid.NewGuid());
            var asStranger = await Move("stranger", _ownBoard.Id, _room.Id);

            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            asStranger.StatusCode.ShouldBe(HttpStatusCode.NotFound); // no write on the board: the board is not theirs
            (await InDbAsync(db => db.Boards.SingleAsync(b => b.Id == _ownBoard.Id))).RoomId.ShouldBeNull();
        }

        [Test]
        public async Task A_room_of_other_people_is_404_for_a_board_the_caller_may_write()
        {
            var secret = Room.Create(Guid.CreateVersion7(), "Secret", Now, _users["owner"].Id);
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
                db.Add(secret);
                await db.SaveChangesAsync();
            }

            var response = await Move("editor", _ownBoard.Id, secret.Id);

            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }

        [Test]
        public async Task Needs_write_on_the_board_itself()
        {
            // A viewer of the room is a viewer of the board: they cannot take it out of the room either.
            var response = await Move("viewer", _boardInRoom.Id, null);

            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await InDbAsync(db => db.Boards.SingleAsync(b => b.Id == _boardInRoom.Id))).RoomId.ShouldBe(_room.Id);
        }

        [Test]
        public async Task A_board_the_caller_cannot_see_is_404() =>
            (await Move("stranger", _boardInRoom.Id, null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        [Test]
        public async Task Refuses_a_body_without_a_value_with_400()
        {
            var response = await As("owner").PutAsync($"/boards/{_boardInRoom.Id}/room", Json(null));

            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }

        [Test]
        public async Task Refuses_a_body_that_is_not_json_with_415() =>
            (await As("owner").PutAsync($"/boards/{_boardInRoom.Id}/room", new StringContent("x"))).StatusCode
            .ShouldBe(HttpStatusCode.UnsupportedMediaType);

        [Test]
        public async Task Needs_a_signed_in_user() =>
            (await _factory.CreateClient()
                .PutAsync($"/boards/{_boardInRoom.Id}/room", Json(new { roomId = (Guid?)null })))
            .StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
