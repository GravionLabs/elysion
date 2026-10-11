using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

using NSubstitute;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>One run of the sync over several groups (#667): a group that fails does not stop the others, and a change leaves one audit entry.</summary>
public class GraphGroupSyncTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private const string A = "aaaaaaaa-1111-4111-8111-111111111111";
    private const string B = "bbbbbbbb-1111-4111-8111-111111111111";
    private const string C = "cccccccc-1111-4111-8111-111111111111";
    private SqliteDatabase _database = null!;

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        await using var db = _database.NewContext();
        db.AddRange(Group.Linked(Guid.CreateVersion7(), A, A, Now),
            Group.Linked(Guid.CreateVersion7(), B, B, Now.AddSeconds(1)),
            Group.Linked(Guid.CreateVersion7(), C, C, Now.AddSeconds(2)),
            User.Create(Guid.CreateVersion7(), "kc-ann", "Ann", "ann@example.com", Now));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private async Task<GraphSyncRun> RunAsync(IGraphClient graph)
    {
        await using var db = _database.NewContext();
        var time = Substitute.For<TimeProvider>();
        time.GetUtcNow().Returns(Now);
        var sync = new GraphGroupSync(graph,
            new GroupSyncRepository(db),
            TestAudit.For(db),
            time,
            NullLogger<GraphGroupSync>.Instance);
        return await sync.RunAsync(Ct);
    }

    [Test]
    public async Task A_group_that_fails_is_skipped_and_the_others_are_synced()
    {
        var graph = Substitute.For<IGraphClient>();
        graph.GetGroupNameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(ci => Task.FromResult<string?>($"Name {ci.Arg<string>()[..1]}"));
        graph.GetMembersAsync(A, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<GraphMember>>([new("o1", "Ann", "ann@example.com", null)]));
        graph.GetMembersAsync(B, Arg.Any<CancellationToken>())
            .Returns<IReadOnlyList<GraphMember>>(_ => throw new GraphException("The directory answered 500."));
        graph.GetMembersAsync(C, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<GraphMember>>([new("o2", "Zoe", "zoe@example.com", null)]));

        var run = await RunAsync(graph);

        run.ShouldBe(new GraphSyncRun(3, 1, 2));
        await using var db = _database.NewContext();
        (await db.Groups.AsNoTracking().SingleAsync(g => g.ExternalId == A)).Name.ShouldBe("Name a");
        (await db.Groups.AsNoTracking().SingleAsync(g => g.ExternalId == B)).GraphSyncedAt.ShouldBeNull();
        (await db.Groups.AsNoTracking().SingleAsync(g => g.ExternalId == C)).GraphSyncedAt.ShouldBe(Now);
        (await db.GroupMemberships.CountAsync()).ShouldBe(1);
        (await db.PendingGroupMemberships.CountAsync()).ShouldBe(1);
    }

    [Test]
    public async Task A_changed_group_leaves_one_entry_by_the_system_with_counts_and_no_address()
    {
        var graph = Substitute.For<IGraphClient>();
        graph.GetGroupNameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<string?>(null));
        graph.GetMembersAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<GraphMember>>([
                new("o1", "Ann", "ann@example.com", null), new("o2", "Zoe", "zoe@example.com", null)
            ]));

        await RunAsync(graph);
        await RunAsync(graph); // nothing changed: no further entries

        await using var db = _database.NewContext();
        var entries = await db.AuditEntries.AsNoTracking()
            .Where(e => e.Action == AuditActions.GroupGraphSynced)
            .ToListAsync(Ct);
        entries.Count.ShouldBe(3);
        entries.ShouldAllBe(e => e.ActorUserId == null && e.SubjectType == AuditActions.Group);
        entries.ShouldAllBe(e => e.Details!.Contains("\"added\":1") && e.Details.Contains("\"pendingAdded\":1"));
        entries.ShouldAllBe(e => !e.Details!.Contains('@') && !e.Details.Contains("example"));
    }

    [Test]
    public async Task Cancelling_stops_the_run()
    {
        var graph = Substitute.For<IGraphClient>();
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        await using var db = _database.NewContext();
        var sync = new GraphGroupSync(graph,
            new GroupSyncRepository(db),
            TestAudit.For(db),
            TimeProvider.System,
            NullLogger<GraphGroupSync>.Instance);

        await Should.ThrowAsync<OperationCanceledException>(() => sync.RunAsync(cancelled.Token));
    }
}
