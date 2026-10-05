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

    private static User NewUser(string subject) =>
        User.Create(Guid.CreateVersion7(), subject, subject, null, Now);

    private async Task SeedAsync(params object[] entities)
    {
        await using var db = _database.NewContext();
        db.AddRange(entities);
        await db.SaveChangesAsync();
    }

    [Test]
    public async Task Lists_only_the_boards_of_the_user_newest_first()
    {
        var ada = NewUser("ada");
        var bea = NewUser("bea");
        var owned = Board.Create(Guid.CreateVersion7(), "owned", Now.AddMinutes(-30), ada.Id);
        var shared = Board.Create(Guid.CreateVersion7(), "shared", Now.AddMinutes(-10), bea.Id);
        var newest = Board.Create(Guid.CreateVersion7(), "newest", Now.AddMinutes(-1), ada.Id);
        var others = Board.Create(Guid.CreateVersion7(), "others", Now, bea.Id);
        var ownerless = Board.Create(Guid.CreateVersion7(), "ownerless", Now);
        await SeedAsync(
            ada, bea, owned, shared, newest, others, ownerless,
            BoardMembership.Create(shared.Id, ada.Id, BoardRole.Viewer, Now));
        await using var db = _database.NewContext();

        var boards = await new BoardRepository(db).ListVisibleToAsync(ada.Id, CancellationToken.None);

        boards.Select(b => b.Name).ShouldBe(["newest", "shared", "owned"]);
    }

    [Test]
    public async Task Lists_nothing_for_a_user_without_boards()
    {
        var ada = NewUser("ada");
        await SeedAsync(ada, NewBoard("ownerless"));
        await using var db = _database.NewContext();

        (await new BoardRepository(db).ListVisibleToAsync(ada.Id, CancellationToken.None)).ShouldBeEmpty();
    }

    [Test]
    public async Task The_role_is_the_membership_role_and_the_owner_is_an_owner_without_a_membership_row()
    {
        var owner = NewUser("owner");
        var editor = NewUser("editor");
        var viewer = NewUser("viewer");
        var stranger = NewUser("stranger");
        var board = Board.Create(Guid.CreateVersion7(), "Retro", Now, owner.Id); // no membership row for the owner
        await SeedAsync(
            owner, editor, viewer, stranger, board,
            BoardMembership.Create(board.Id, editor.Id, BoardRole.Editor, Now),
            BoardMembership.Create(board.Id, viewer.Id, BoardRole.Viewer, Now));
        await using var db = _database.NewContext();
        var repository = new BoardRepository(db);

        (await repository.GetRoleAsync(board.Id, owner.Id, CancellationToken.None)).ShouldBe(BoardRole.Owner);
        (await repository.GetRoleAsync(board.Id, editor.Id, CancellationToken.None)).ShouldBe(BoardRole.Editor);
        (await repository.GetRoleAsync(board.Id, viewer.Id, CancellationToken.None)).ShouldBe(BoardRole.Viewer);
        (await repository.GetRoleAsync(board.Id, stranger.Id, CancellationToken.None)).ShouldBeNull();
        (await repository.GetRoleAsync(Guid.NewGuid(), owner.Id, CancellationToken.None)).ShouldBeNull();
    }

    [Test]
    public async Task An_owner_with_a_lower_membership_row_is_still_the_owner()
    {
        var owner = NewUser("owner");
        var board = Board.Create(Guid.CreateVersion7(), "Retro", Now, owner.Id);
        await SeedAsync(owner, board, BoardMembership.Create(board.Id, owner.Id, BoardRole.Viewer, Now));
        await using var db = _database.NewContext();

        (await new BoardRepository(db).GetRoleAsync(board.Id, owner.Id, CancellationToken.None)).ShouldBe(BoardRole.Owner);
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
