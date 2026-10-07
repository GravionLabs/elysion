using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// What a room adds to a board's access (ADR 0019), at the repository: who sees a board, and the role they
/// have on it, when it is in a room.
/// </summary>
public class BoardRoomAccessTests
{
    private SqliteDatabase _database = null!;
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static User NewUser(string subject) => User.Create(Guid.CreateVersion7(), subject, subject, null, Now);

    private async Task SeedAsync(params object[] entities)
    {
        await using var db = _database.NewContext();
        db.AddRange(entities);
        await db.SaveChangesAsync();
    }

    private User _ada = null!;
    private User _bea = null!;
    private Room _room = null!;
    private Board _inRoom = null!;

    [SetUp]
    public async Task SeedRoom()
    {
        _database = new SqliteDatabase();
        _ada = NewUser("ada");
        _bea = NewUser("bea");
        _room = Room.Create(Guid.CreateVersion7(), "Sprint", Now, _bea.Id);
        _inRoom = Board.Create(Guid.CreateVersion7(), "In the room", Now, _bea.Id);
        _inRoom.RoomId = _room.Id;
        await SeedAsync(_ada, _bea, _room, _inRoom);
    }

    private async Task AddRoomMembershipAsync(User user, BoardRole role) =>
        await SeedAsync(RoomMembership.Create(_room.Id, user.Id, role, Now));

    private async Task<BoardRole?> RoleAsync(User user)
    {
        await using var db = _database.NewContext();
        return await new BoardRepository(db).GetRoleAsync(_inRoom.Id, user.Id, CancellationToken.None);
    }

    private async Task<string[]> VisibleToAsync(User user)
    {
        await using var db = _database.NewContext();
        return (await new BoardRepository(db).ListVisibleToAsync(user.Id, CancellationToken.None))
            .Select(b => b.Name)
            .ToArray();
    }

    [TestCase(BoardRole.Viewer)]
    [TestCase(BoardRole.Editor)]
    [TestCase(BoardRole.Owner)]
    public async Task A_room_member_sees_the_boards_of_the_room_with_the_role_of_the_room(BoardRole inRoom)
    {
        await AddRoomMembershipAsync(_ada, inRoom);

        (await VisibleToAsync(_ada)).ShouldBe(["In the room"]);
        (await RoleAsync(_ada)).ShouldBe(inRoom);
    }

    [Test]
    public async Task The_creator_of_the_room_has_its_role_without_a_membership_row()
    {
        var creator = _bea; // owner of the room and of the board
        var roomOnly = Board.Create(Guid.CreateVersion7(), "Room only", Now, _ada.Id);
        roomOnly.RoomId = _room.Id;
        await SeedAsync(roomOnly);
        await using var db = _database.NewContext();

        var role = await new BoardRepository(db).GetRoleAsync(roomOnly.Id, creator.Id, CancellationToken.None);

        role.ShouldBe(BoardRole.Owner);
    }

    [Test]
    public async Task A_stranger_has_no_role_and_sees_nothing()
    {
        (await RoleAsync(_ada)).ShouldBeNull();
        (await VisibleToAsync(_ada)).ShouldBeEmpty();
    }

    [Test]
    public async Task The_higher_of_the_board_role_and_the_room_role_counts()
    {
        await AddRoomMembershipAsync(_ada, BoardRole.Viewer);
        await SeedAsync(BoardMembership.Create(_inRoom.Id, _ada.Id, BoardRole.Editor, Now));
        (await RoleAsync(_ada)).ShouldBe(BoardRole.Editor); // the board's own role is higher

        await using (var db = _database.NewContext())
        {
            var membership = await db.RoomMemberships.SingleAsync();
            membership.Role = BoardRole.Owner;
            await db.SaveChangesAsync();
        }

        (await RoleAsync(_ada)).ShouldBe(BoardRole.Owner); // now the room's role is higher
    }

    [Test]
    public async Task Taking_the_board_out_of_the_room_takes_the_access_the_room_gave_but_not_the_boards_own()
    {
        await AddRoomMembershipAsync(_ada, BoardRole.Editor);
        var bea2 = NewUser("bea2");
        await SeedAsync(bea2,
            RoomMembership.Create(_room.Id, bea2.Id, BoardRole.Viewer, Now),
            BoardMembership.Create(_inRoom.Id, bea2.Id, BoardRole.Viewer, Now));
        await using (var db = _database.NewContext())
        {
            var board = await new BoardRepository(db).FindForUpdateAsync(_inRoom.Id, CancellationToken.None);
            board!.RoomId = null;
            await db.SaveChangesAsync();
        }

        (await RoleAsync(_ada)).ShouldBeNull();
        (await VisibleToAsync(_ada)).ShouldBeEmpty();
        (await RoleAsync(bea2)).ShouldBe(BoardRole.Viewer); // invited to the board itself: stays
    }

    [Test]
    public async Task Deleting_the_room_takes_the_access_with_it_and_the_board_stays_for_its_owner()
    {
        await AddRoomMembershipAsync(_ada, BoardRole.Editor);
        await using (var db = _database.NewContext())
        {
            var room = await new RoomRepository(db).FindForUpdateAsync(_room.Id, CancellationToken.None);
            new RoomRepository(db).Remove(room!);
            await db.SaveChangesAsync();
        }

        (await RoleAsync(_ada)).ShouldBeNull();
        (await RoleAsync(_bea)).ShouldBe(BoardRole.Owner);
        (await VisibleToAsync(_bea)).ShouldBe(["In the room"]);
    }

    [Test]
    public async Task A_board_is_listed_once_when_the_user_has_several_ways_to_it()
    {
        await AddRoomMembershipAsync(_ada, BoardRole.Viewer);
        await SeedAsync(BoardMembership.Create(_inRoom.Id, _ada.Id, BoardRole.Viewer, Now));

        (await VisibleToAsync(_ada)).ShouldBe(["In the room"]);
    }
}
