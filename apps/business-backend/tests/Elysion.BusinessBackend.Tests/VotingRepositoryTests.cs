using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>What only a relational database enforces for votings: the cascade with the board and one open voting per board (#732).</summary>
public class VotingRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 12, 0, 0, TimeSpan.Zero);

    private SqliteDatabase _database = null!;
    private readonly User _ada = User.Create(Guid.CreateVersion7(), "ada", "Ada", null, Now);
    private readonly Board _board = Board.Create(Guid.CreateVersion7(), "Board", Now);

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        await using var db = _database.NewContext();
        db.AddRange(_ada, _board);
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private VotingSession NewSession(VotingStatus status = VotingStatus.Open) => new()
    {
        Id = Guid.CreateVersion7(),
        BoardId = _board.Id,
        Name = "Voting",
        VotesPerPerson = 3,
        Status = status,
        StartedBySubject = "ada",
        StartedByName = "Ada",
        StartedAt = Now,
    };

    [Test]
    public async Task Deleting_the_board_deletes_its_votings_and_votes()
    {
        var session = NewSession();
        await using (var db = _database.NewContext())
        {
            db.VotingSessions.Add(session);
            db.Votes.Add(new Vote
            {
                Id = Guid.CreateVersion7(), VotingSessionId = session.Id, UserId = _ada.Id, ElementId = "e1",
                CreatedAt = Now,
            });
            await db.SaveChangesAsync();
        }

        await using (var db = _database.NewContext())
        {
            db.Boards.Remove(await db.Boards.SingleAsync(b => b.Id == _board.Id));
            await db.SaveChangesAsync();
        }

        await using var check = _database.NewContext();
        (await check.VotingSessions.CountAsync()).ShouldBe(0);
        (await check.Votes.CountAsync()).ShouldBe(0);
    }

    [Test]
    public async Task The_database_lets_only_one_voting_be_open_per_board_but_any_number_be_closed()
    {
        await using var db = _database.NewContext();
        db.VotingSessions.AddRange(NewSession(VotingStatus.Closed), NewSession(VotingStatus.Closed), NewSession());
        await db.SaveChangesAsync();

        db.VotingSessions.Add(NewSession());

        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Test]
    public async Task The_current_voting_is_the_open_one_else_the_one_closed_last()
    {
        var older = NewSession(VotingStatus.Closed);
        older.ClosedAt = Now.AddMinutes(1);
        var newer = NewSession(VotingStatus.Closed);
        newer.ClosedAt = Now.AddMinutes(5);
        await using (var db = _database.NewContext())
        {
            db.VotingSessions.AddRange(older, newer);
            await db.SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        var repository = new VotingRepository(read);

        (await repository.GetCurrentAsync(_board.Id, CancellationToken.None))!.Id.ShouldBe(newer.Id);
        (await repository.GetCurrentAsync(Guid.NewGuid(), CancellationToken.None)).ShouldBeNull();
    }
}
