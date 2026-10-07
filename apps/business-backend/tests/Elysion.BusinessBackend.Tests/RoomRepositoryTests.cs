using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class RoomRepositoryTests
{
    private SqliteDatabase _database = null!;
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    [SetUp]
    public void SetUp() => _database = new SqliteDatabase();

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static User NewUser(string subject) => User.Create(Guid.CreateVersion7(), subject, subject, null, Now);

    private static Room NewRoom(string name, Guid owner, int minutesAgo = 0) =>
        Room.Create(Guid.CreateVersion7(), name, Now.AddMinutes(-minutesAgo), owner);

    private async Task SeedAsync(params object[] entities)
    {
        await using var db = _database.NewContext();
        db.AddRange(entities);
        await db.SaveChangesAsync();
    }

    [Test]
    public async Task Lists_the_rooms_of_the_user_by_name_and_not_the_rooms_of_others()
    {
        var ada = NewUser("ada");
        var bea = NewUser("bea");
        var owned = NewRoom("Workshops", ada.Id);
        var member = NewRoom("Customer X", bea.Id);
        var first = NewRoom("Backlog", ada.Id);
        var others = NewRoom("Secret", bea.Id);
        await SeedAsync(ada,
            bea,
            owned,
            member,
            first,
            others,
            RoomMembership.Create(member.Id, ada.Id, BoardRole.Viewer, Now));
        await using var db = _database.NewContext();

        var rooms = await new RoomRepository(db).ListVisibleToAsync(ada.Id, CancellationToken.None);

        rooms.Select(r => r.Name).ShouldBe(["Backlog", "Customer X", "Workshops"]);
    }

    [Test]
    public async Task The_role_is_the_membership_and_the_creator_is_an_owner_without_one()
    {
        var creator = NewUser("creator");
        var editor = NewUser("editor");
        var stranger = NewUser("stranger");
        var room = NewRoom("Sprint", creator.Id);
        await SeedAsync(creator,
            editor,
            stranger,
            room,
            RoomMembership.Create(room.Id, editor.Id, BoardRole.Editor, Now));
        await using var db = _database.NewContext();
        var repository = new RoomRepository(db);

        (await repository.GetRoleAsync(room.Id, creator.Id, CancellationToken.None)).ShouldBe(BoardRole.Owner);
        (await repository.GetRoleAsync(room.Id, editor.Id, CancellationToken.None)).ShouldBe(BoardRole.Editor);
        (await repository.GetRoleAsync(room.Id, stranger.Id, CancellationToken.None)).ShouldBeNull();
        (await repository.GetRoleAsync(Guid.CreateVersion7(), creator.Id, CancellationToken.None)).ShouldBeNull();
    }

    [Test]
    public async Task Finds_a_room_untracked_or_tracked()
    {
        var ada = NewUser("ada");
        var room = NewRoom("Sprint", ada.Id);
        await SeedAsync(ada, room);
        await using var db = _database.NewContext();
        var repository = new RoomRepository(db);

        (await repository.FindAsync(room.Id, CancellationToken.None))!.Name.ShouldBe("Sprint");
        db.ChangeTracker.Entries().ShouldBeEmpty();
        (await repository.FindForUpdateAsync(room.Id, CancellationToken.None))!.Name = "Renamed";
        await db.SaveChangesAsync();

        await using var check = _database.NewContext();
        (await check.Rooms.SingleAsync()).Name.ShouldBe("Renamed");
        (await repository.FindAsync(Guid.CreateVersion7(), CancellationToken.None)).ShouldBeNull();
    }

    [Test]
    public async Task Deleting_a_room_keeps_its_boards_and_takes_them_out_of_the_room()
    {
        var ada = NewUser("ada");
        var room = NewRoom("Sprint", ada.Id);
        var inRoom = Board.Create(Guid.CreateVersion7(), "In the room", Now, ada.Id);
        inRoom.RoomId = room.Id;
        var elsewhere = Board.Create(Guid.CreateVersion7(), "Elsewhere", Now, ada.Id);
        await SeedAsync(ada, room, inRoom, elsewhere, RoomMembership.Create(room.Id, ada.Id, BoardRole.Owner, Now));
        await using (var db = _database.NewContext())
        {
            var repository = new RoomRepository(db);
            repository.Remove((await repository.FindForUpdateAsync(room.Id, CancellationToken.None))!);
            await db.SaveChangesAsync();
        }

        await using var check = _database.NewContext();
        (await check.Rooms.AnyAsync()).ShouldBeFalse();
        (await check.RoomMemberships.AnyAsync()).ShouldBeFalse(); // the memberships go with the room
        var boards = await check.Boards.OrderBy(b => b.Name).ToListAsync();
        boards.Select(b => b.Name).ShouldBe(["Elsewhere", "In the room"]);
        boards.ShouldAllBe(b => b.RoomId == null);
    }

    [Test]
    public async Task Lists_the_boards_of_a_room_tracked_and_no_others()
    {
        var ada = NewUser("ada");
        var room = NewRoom("Sprint", ada.Id);
        var other = NewRoom("Other", ada.Id);
        var inRoom = Board.Create(Guid.CreateVersion7(), "In", Now, ada.Id);
        inRoom.RoomId = room.Id;
        var inOther = Board.Create(Guid.CreateVersion7(), "Other", Now, ada.Id);
        inOther.RoomId = other.Id;
        await SeedAsync(ada, room, other, inRoom, inOther);
        await using var db = _database.NewContext();

        var boards = await new BoardRepository(db).ListInRoomForUpdateAsync(room.Id, CancellationToken.None);

        boards.Select(b => b.Name).ShouldBe(["In"]);
        db.ChangeTracker.Entries<Board>().Count().ShouldBe(1);
    }

    [Test]
    public async Task A_membership_is_unique_per_user_and_room_and_listed_in_the_order_it_was_given()
    {
        var ada = NewUser("ada");
        var bea = NewUser("bea");
        var room = NewRoom("Sprint", ada.Id);
        await SeedAsync(ada,
            bea,
            room,
            RoomMembership.Create(room.Id, bea.Id, BoardRole.Viewer, Now.AddMinutes(2)),
            RoomMembership.Create(room.Id, ada.Id, BoardRole.Owner, Now.AddMinutes(1)));
        await using var db = _database.NewContext();
        var repository = new RoomMembershipRepository(db);

        var list = await repository.ListForRoomAsync(room.Id, CancellationToken.None);

        list.Select(m => m.User!.DisplayName).ShouldBe(["ada", "bea"]);
        await using var second = _database.NewContext();
        new RoomMembershipRepository(second).Add(RoomMembership.Create(room.Id, ada.Id, BoardRole.Editor, Now));
        await Should.ThrowAsync<DbUpdateException>(() => second.SaveChangesAsync());
    }
}
