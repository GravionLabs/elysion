using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>What only a relational database enforces for invitation links: the cascade, a unique token hash, one target and the count of uses (#734).</summary>
public class InvitationRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 12, 0, 0, TimeSpan.Zero);

    private SqliteDatabase _database = null!;
    private readonly User _ada = User.Create(Guid.CreateVersion7(), "ada", "Ada", null, Now);
    private readonly Board _board = Board.Create(Guid.CreateVersion7(), "Board", Now);
    private readonly Room _room;

    public InvitationRepositoryTests() => _room = Room.Create(Guid.CreateVersion7(), "Room", Now, _ada.Id);

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        await using var db = _database.NewContext();
        db.AddRange(_ada, _board, _room);
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private Invitation New(string hash, Guid? boardId, Guid? roomId) => new()
    {
        Id = Guid.CreateVersion7(),
        TokenHash = hash,
        BoardId = boardId,
        RoomId = roomId,
        Role = BoardRole.Viewer,
        ExpiresAt = Now.AddDays(1),
        CreatedByUserId = _ada.Id,
        CreatedAt = Now,
    };

    [Test]
    public async Task Deleting_a_board_or_a_room_deletes_its_links()
    {
        await using (var db = _database.NewContext())
        {
            db.Invitations.AddRange(New("a", _board.Id, null), New("b", null, _room.Id));
            await db.SaveChangesAsync();
        }

        await using (var db = _database.NewContext())
        {
            db.Boards.Remove(await db.Boards.SingleAsync(b => b.Id == _board.Id));
            db.Rooms.Remove(await db.Rooms.SingleAsync(r => r.Id == _room.Id));
            await db.SaveChangesAsync();
        }

        await using var check = _database.NewContext();
        (await check.Invitations.CountAsync()).ShouldBe(0);
    }

    [Test]
    public async Task Two_links_cannot_share_a_token_hash()
    {
        await using var db = _database.NewContext();
        db.Invitations.AddRange(New("same", _board.Id, null), New("same", null, _room.Id));

        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Test]
    public async Task A_link_belongs_to_exactly_one_of_a_board_and_a_room()
    {
        await using (var db = _database.NewContext())
        {
            db.Invitations.Add(New("none", null, null));
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }

        await using (var db = _database.NewContext())
        {
            db.Invitations.Add(New("both", _board.Id, _room.Id));
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }
    }

    [Test]
    public async Task Two_people_cannot_both_take_the_same_use()
    {
        var invitation = New("race", _board.Id, null);
        await using (var db = _database.NewContext())
        {
            db.Invitations.Add(invitation);
            await db.SaveChangesAsync();
        }

        await using var first = _database.NewContext();
        await using var second = _database.NewContext();
        (await first.Invitations.SingleAsync()).Uses++;
        (await second.Invitations.SingleAsync()).Uses++;
        await first.SaveChangesAsync();

        await Should.ThrowAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
    }
}
