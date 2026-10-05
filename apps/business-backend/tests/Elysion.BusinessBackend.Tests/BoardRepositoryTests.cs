using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class BoardRepositoryTests
{
    private SqliteDatabase _database = null!;
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    [SetUp]
    public void SetUp() => _database = new SqliteDatabase();

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static Board NewBoard(string name, int minutesAgo = 0) =>
        Board.Create(Guid.CreateVersion7(), name, Now.AddMinutes(-minutesAgo));

    private async Task SeedAsync(params Board[] boards)
    {
        await using var db = _database.NewContext();
        db.Boards.AddRange(boards);
        await db.SaveChangesAsync();
    }

    [Test]
    public async Task Lists_the_newest_board_first()
    {
        await SeedAsync(NewBoard("old", 30), NewBoard("new", 1), NewBoard("middle", 10));
        await using var db = _database.NewContext();

        var boards = await new BoardRepository(db).ListNewestFirstAsync(CancellationToken.None);

        boards.Select(b => b.Name).ShouldBe(["new", "middle", "old"]);
    }

    [Test]
    public async Task Finds_a_board_and_answers_null_for_an_unknown_one()
    {
        var board = NewBoard("Retro");
        await SeedAsync(board);
        await using var db = _database.NewContext();
        var repository = new BoardRepository(db);

        (await repository.FindAsync(board.Id, CancellationToken.None))!.Name.ShouldBe("Retro");
        (await repository.FindAsync(Guid.NewGuid(), CancellationToken.None)).ShouldBeNull();
    }

    [Test]
    public async Task A_board_from_FindAsync_is_not_tracked_so_changing_it_saves_nothing()
    {
        var board = NewBoard("Retro");
        await SeedAsync(board);
        await using (var db = _database.NewContext())
        {
            var found = (await new BoardRepository(db).FindAsync(board.Id, CancellationToken.None))!;
            found.Name = "changed";
            await db.SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        (await new BoardRepository(read).FindAsync(board.Id, CancellationToken.None))!.Name.ShouldBe("Retro");
    }

    [Test]
    public async Task A_board_from_FindForUpdateAsync_is_saved_by_the_unit_of_work()
    {
        var board = NewBoard("Retro");
        await SeedAsync(board);
        await using (var db = _database.NewContext())
        {
            var found = (await new BoardRepository(db).FindForUpdateAsync(board.Id, CancellationToken.None))!;
            found.Name = "Renamed";
            await ((IUnitOfWork)db).SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        (await new BoardRepository(read).FindAsync(board.Id, CancellationToken.None))!.Name.ShouldBe("Renamed");
    }

    [Test]
    public async Task Add_and_Remove_only_stage_until_the_unit_of_work_commits()
    {
        var board = NewBoard("Retro");
        await using (var db = _database.NewContext())
        {
            new BoardRepository(db).Add(board);
            (await _database.NewContext().Boards.CountAsync()).ShouldBe(0); // not committed yet
            await ((IUnitOfWork)db).SaveChangesAsync();
        }

        await using (var db = _database.NewContext())
        {
            var repository = new BoardRepository(db);
            repository.Remove((await repository.FindForUpdateAsync(board.Id, CancellationToken.None))!);
            (await _database.NewContext().Boards.CountAsync()).ShouldBe(1); // staged, not committed
            await ((IUnitOfWork)db).SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        (await read.Boards.CountAsync()).ShouldBe(0);
    }

    [Test]
    public async Task Refuses_an_empty_id_and_a_missing_board_as_programming_errors()
    {
        await using var db = _database.NewContext();
        var repository = new BoardRepository(db);

        await Should.ThrowAsync<ArgumentException>(() => repository.FindAsync(Guid.Empty, CancellationToken.None));
        await Should.ThrowAsync<ArgumentException>(() => repository.FindForUpdateAsync(Guid.Empty, CancellationToken.None));
        Should.Throw<ArgumentNullException>(() => repository.Add(null!));
        Should.Throw<ArgumentNullException>(() => repository.Remove(null!));
    }
}
