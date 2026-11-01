using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class BoardSnapshotRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;

    private SqliteDatabase _database = null!;
    private Board _board = null!;
    private User _author = null!;

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        _author = User.Create(Guid.CreateVersion7(), "kc-author", "Ann", "ann@example.com", Now);
        _board = Board.Create(Guid.CreateVersion7(), "Retro", Now, _author.Id);
        await using var db = _database.NewContext();
        db.AddRange(_author, _board);
        await db.SaveChangesAsync(Ct);
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static BoardSnapshot Snapshot(Guid boardId,
        SnapshotKind kind,
        DateTimeOffset at,
        string? createdBy = null) =>
        new() { Id = Guid.CreateVersion7(), BoardId = boardId, Kind = kind, CreatedAt = at, CreatedBy = createdBy };

    private async Task<T> InRepositoryAsync<T>(Func<BoardSnapshotRepository, ElysionDbContext, Task<T>> action)
    {
        await using var db = _database.NewContext();
        return await action(new BoardSnapshotRepository(db), db);
    }

    private async Task AddAsync(params BoardSnapshot[] snapshots) =>
        await InRepositoryAsync(async (repository, db) =>
        {
            foreach (var snapshot in snapshots)
                repository.Add(snapshot);
            await db.SaveChangesAsync(Ct);
            return 0;
        });

    [Test]
    public async Task The_list_is_newest_first_with_the_display_name_of_the_author()
    {
        var older = Snapshot(_board.Id, SnapshotKind.Manual, Now, "kc-author");
        var newer = Snapshot(_board.Id, SnapshotKind.Auto, Now.AddHours(2));
        await AddAsync(older, newer);

        var listed = await InRepositoryAsync((r, _) => r.ListNewestFirstAsync(_board.Id, Ct));

        listed.Select(l => l.Snapshot.Id).ShouldBe([newer.Id, older.Id]);
        listed[1].Author.ShouldBe("Ann");
        listed[0].Author.ShouldBeNull();
    }

    [Test]
    public async Task A_snapshot_of_an_unknown_author_is_listed_without_a_name()
    {
        await AddAsync(Snapshot(_board.Id, SnapshotKind.Manual, Now, "kc-gone"));

        (await InRepositoryAsync((r, _) => r.ListNewestFirstAsync(_board.Id, Ct))).Single().Author.ShouldBeNull();
    }

    [Test]
    public async Task Find_needs_the_board_and_the_id_to_match()
    {
        var snapshot = Snapshot(_board.Id, SnapshotKind.Manual, Now);
        await AddAsync(snapshot);

        (await InRepositoryAsync((r, _) => r.FindAsync(_board.Id, snapshot.Id, Ct)))!.Value.Snapshot.Id
            .ShouldBe(snapshot.Id);
        (await InRepositoryAsync((r, _) => r.FindAsync(Guid.CreateVersion7(), snapshot.Id, Ct))).ShouldBeNull();
        (await InRepositoryAsync((r, _) => r.FindForUpdateAsync(_board.Id, Guid.CreateVersion7(), Ct))).ShouldBeNull();
    }

    [Test]
    public async Task Newest_and_counts_look_at_the_board_and_the_kind()
    {
        await AddAsync(
            Snapshot(_board.Id, SnapshotKind.Manual, Now),
            Snapshot(_board.Id, SnapshotKind.Auto, Now.AddHours(1)),
            Snapshot(_board.Id, SnapshotKind.BeforeRestore, Now.AddHours(2)));

        (await InRepositoryAsync((r, _) => r.NewestAtAsync(_board.Id, Ct))).ShouldBe(Now.AddHours(2));
        (await InRepositoryAsync((r, _) => r.NewestAtAsync(Guid.CreateVersion7(), Ct))).ShouldBeNull();
        (await InRepositoryAsync((r, _) => r.CountAsync(_board.Id, true, Ct))).ShouldBe(1);
        (await InRepositoryAsync((r, _) => r.CountAsync(_board.Id, false, Ct))).ShouldBe(2);
    }

    [Test]
    public async Task Beyond_returns_the_oldest_automatic_ones_and_never_a_manual_one()
    {
        var manual = Snapshot(_board.Id, SnapshotKind.Manual, Now.AddDays(-100));
        var autos = Enumerable.Range(0, 4)
            .Select(i => Snapshot(_board.Id, SnapshotKind.Auto, Now.AddHours(i)))
            .ToArray();
        await AddAsync([manual, .. autos]);

        var surplus = await InRepositoryAsync((r, _) => r.AutomaticBeyondAsync(_board.Id, 2, Ct));

        surplus.Select(s => s.Id).ShouldBe([autos[0].Id, autos[1].Id]);
    }

    [Test]
    public async Task Older_than_returns_automatic_ones_before_the_cutoff_oldest_first_up_to_the_batch_size()
    {
        var old1 = Snapshot(_board.Id, SnapshotKind.Auto, Now.AddDays(-40));
        var old2 = Snapshot(_board.Id, SnapshotKind.BeforeRestore, Now.AddDays(-35));
        await AddAsync(old2,
            old1,
            Snapshot(_board.Id, SnapshotKind.Manual, Now.AddDays(-90)),
            Snapshot(_board.Id, SnapshotKind.Auto, Now.AddDays(-1)));

        var expired = await InRepositoryAsync((r, _) => r.AutomaticOlderThanAsync(Now.AddDays(-30), 10, Ct));
        var first = await InRepositoryAsync((r, _) => r.AutomaticOlderThanAsync(Now.AddDays(-30), 1, Ct));

        expired.Select(s => s.Id).ShouldBe([old1.Id, old2.Id]);
        first.Select(s => s.Id).ShouldBe([old1.Id]);
    }

    [Test]
    public async Task Snapshots_go_with_their_board()
    {
        await AddAsync(Snapshot(_board.Id, SnapshotKind.Manual, Now));

        await InRepositoryAsync(async (_, db) =>
        {
            db.Boards.Remove(await db.Boards.FindAsync([_board.Id], Ct) ?? throw new InvalidOperationException());
            await db.SaveChangesAsync(Ct);
            return 0;
        });

        (await InRepositoryAsync((r, _) => r.IdsAsync(_board.Id, Ct))).ShouldBeEmpty();
    }

    [Test]
    public async Task Remove_deletes_the_row_at_the_commit()
    {
        var snapshot = Snapshot(_board.Id, SnapshotKind.Manual, Now);
        await AddAsync(snapshot);

        await InRepositoryAsync(async (r, db) =>
        {
            r.Remove((await r.FindForUpdateAsync(_board.Id, snapshot.Id, Ct))!);
            await db.SaveChangesAsync(Ct);
            return 0;
        });

        (await InRepositoryAsync((r, _) => r.IdsAsync(_board.Id, Ct))).ShouldBeEmpty();
    }
}
