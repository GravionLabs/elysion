using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class BoardDocumentRepositoryTests
{
    private SqliteDatabase _database = null!;
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;

    [SetUp]
    public void SetUp() => _database = new SqliteDatabase();

    [TearDown]
    public void TearDown() => _database.Dispose();

    /// <summary>Each call is a new context, like a new request.</summary>
    private async Task<T> WithRepositoryAsync<T>(Func<IBoardDocumentRepository, IUnitOfWork, Task<T>> action)
    {
        await using var db = _database.NewContext();
        return await action(new BoardDocumentRepository(db), db);
    }

    private static byte[] Bytes(params byte[] bytes) => bytes;

    [Test]
    public async Task A_first_save_stores_version_1()
    {
        var result = await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(1, 2), null, Now, Ct));

        result.Status.ShouldBe(DocumentSaveStatus.Saved);
        result.Document!.Version.ShouldBe(1);
        var stored = await WithRepositoryAsync((r, _) => r.FindAsync("b1", Ct));
        stored!.State.ShouldBe(Bytes(1, 2));
        stored.Version.ShouldBe(1);
    }

    [Test]
    public async Task A_save_based_on_the_current_version_raises_it_by_one()
    {
        await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(1), null, Now, Ct));

        var result = await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(2), 1, Now.AddMinutes(1), Ct));

        result.Status.ShouldBe(DocumentSaveStatus.Saved);
        result.Document!.Version.ShouldBe(2);
        (await WithRepositoryAsync((r, _) => r.FindAsync("b1", Ct)))!.State.ShouldBe(Bytes(2));
    }

    [Test]
    public async Task A_save_based_on_an_old_version_is_a_conflict_that_returns_what_is_stored()
    {
        await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(1), null, Now, Ct));
        await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(2), 1, Now, Ct));

        var result = await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(3), 1, Now, Ct));

        result.Status.ShouldBe(DocumentSaveStatus.Conflict);
        result.Document!.Version.ShouldBe(2);
        result.Document.State.ShouldBe(Bytes(2));
        (await WithRepositoryAsync((r, _) => r.FindAsync("b1", Ct)))!.State.ShouldBe(Bytes(2)); // nothing overwritten
    }

    [Test]
    public async Task A_first_save_over_an_existing_document_is_a_conflict()
    {
        await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(1), null, Now, Ct));

        var result = await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(9), null, Now, Ct));

        result.Status.ShouldBe(DocumentSaveStatus.Conflict);
        result.Document!.State.ShouldBe(Bytes(1));
    }

    [Test]
    public async Task An_update_of_a_missing_document_is_not_found()
    {
        var result = await WithRepositoryAsync((r, _) => r.SaveAsync("nope", Bytes(1), 1, Now, Ct));

        result.Status.ShouldBe(DocumentSaveStatus.NotFound);
        result.Document.ShouldBeNull();
    }

    [Test]
    public async Task Finds_nothing_for_an_unknown_board()
    {
        (await WithRepositoryAsync((r, _) => r.FindAsync("nope", Ct))).ShouldBeNull();
    }

    [Test]
    public async Task Remove_stages_the_removal_and_the_unit_of_work_commits_it()
    {
        await WithRepositoryAsync((r, _) => r.SaveAsync("b1", Bytes(1), null, Now, Ct));

        var removed = await WithRepositoryAsync(async (r, uow) =>
        {
            var found = await r.RemoveAsync("b1", Ct);
            await uow.SaveChangesAsync(Ct);
            return found;
        });

        removed.ShouldBeTrue();
        (await WithRepositoryAsync((r, _) => r.FindAsync("b1", Ct))).ShouldBeNull();
        (await WithRepositoryAsync((r, _) => r.RemoveAsync("b1", Ct))).ShouldBeFalse();
    }

    [Test]
    public async Task Add_stages_a_document_with_the_board_it_belongs_to_in_one_commit()
    {
        await WithRepositoryAsync(async (r, uow) =>
        {
            r.Add(new BoardDocument { BoardId = "copy", State = Bytes(7), Version = 1, UpdatedAt = Now });
            await uow.SaveChangesAsync(Ct);
            return 0;
        });

        (await WithRepositoryAsync((r, _) => r.FindAsync("copy", Ct)))!.State.ShouldBe(Bytes(7));
    }

    [Test]
    public async Task Refuses_arguments_that_are_programming_errors()
    {
        await Should.ThrowAsync<ArgumentException>(() => WithRepositoryAsync((r, _) => r.FindAsync(" ", Ct)));
        await Should.ThrowAsync<ArgumentException>(() => WithRepositoryAsync((r, _) => r.SaveAsync("", Bytes(1), null, Now, Ct)));
        await Should.ThrowAsync<ArgumentNullException>(() => WithRepositoryAsync((r, _) => r.SaveAsync("b", null!, null, Now, Ct)));
        await Should.ThrowAsync<ArgumentException>(() => WithRepositoryAsync((r, _) => r.SaveAsync("b", Bytes(1), 0, Now, Ct)));
        await Should.ThrowAsync<ArgumentException>(() => WithRepositoryAsync((r, _) => r.RemoveAsync(null!, Ct)));
    }
}
