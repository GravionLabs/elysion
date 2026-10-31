using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class BoardSnapshotRepository(ElysionDbContext db) : IBoardSnapshotRepository
{
    public async Task<IReadOnlyList<SnapshotListing>> ListNewestFirstAsync(Guid boardId,
        CancellationToken cancellationToken)
    {
        var rows = await Listings(s => s.BoardId == boardId).ToListAsync(cancellationToken);
        // Ordered in memory: SQLite cannot order by DateTimeOffset, and a board holds at most 150 snapshots.
        return rows.OrderByDescending(r => r.Snapshot.CreatedAt)
            .ThenByDescending(r => r.Snapshot.Id)
            .Select(r => new SnapshotListing(r.Snapshot, r.Author))
            .ToList();
    }

    public async Task<SnapshotListing?> FindAsync(Guid boardId, Guid snapshotId, CancellationToken cancellationToken)
    {
        var row = await Listings(s => s.BoardId == boardId && s.Id == snapshotId)
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : new SnapshotListing(row.Snapshot, row.Author);
    }

    public Task<BoardSnapshot?>
        FindForUpdateAsync(Guid boardId, Guid snapshotId, CancellationToken cancellationToken) =>
        db.BoardSnapshots.FirstOrDefaultAsync(s => s.BoardId == boardId && s.Id == snapshotId, cancellationToken);

    public async Task<DateTimeOffset?> NewestAtAsync(Guid boardId, CancellationToken cancellationToken)
    {
        var times = await db.BoardSnapshots.AsNoTracking()
            .Where(s => s.BoardId == boardId)
            .Select(s => s.CreatedAt)
            .ToListAsync(cancellationToken);
        return times.Count == 0 ? null : times.Max();
    }

    public Task<int> CountAsync(Guid boardId, bool manual, CancellationToken cancellationToken) =>
        db.BoardSnapshots.CountAsync(s => s.BoardId == boardId && (s.Kind == SnapshotKind.Manual) == manual,
            cancellationToken);

    public async Task<IReadOnlyList<BoardSnapshot>> AutomaticBeyondAsync(Guid boardId,
        int keep,
        CancellationToken cancellationToken)
    {
        var all = await db.BoardSnapshots.Where(s => s.BoardId == boardId && s.Kind != SnapshotKind.Manual)
            .ToListAsync(cancellationToken);
        return all.OrderByDescending(s => s.CreatedAt).Skip(keep).OrderBy(s => s.CreatedAt).ToList();
    }

    public async Task<IReadOnlyList<BoardSnapshot>> AutomaticOlderThanAsync(DateTimeOffset cutoff,
        int take,
        CancellationToken cancellationToken)
    {
        var all = await db.BoardSnapshots.Where(s => s.Kind != SnapshotKind.Manual).ToListAsync(cancellationToken);
        return all.Where(s => s.CreatedAt < cutoff).OrderBy(s => s.CreatedAt).Take(take).ToList();
    }

    public async Task<IReadOnlySet<Guid>> IdsAsync(Guid boardId, CancellationToken cancellationToken) =>
        (await db.BoardSnapshots.AsNoTracking()
            .Where(s => s.BoardId == boardId)
            .Select(s => s.Id)
            .ToListAsync(cancellationToken)).ToHashSet();

    public void Add(BoardSnapshot snapshot) => db.BoardSnapshots.Add(snapshot);

    public void Remove(BoardSnapshot snapshot) => db.BoardSnapshots.Remove(snapshot);

    private IQueryable<Row> Listings(System.Linq.Expressions.Expression<Func<BoardSnapshot, bool>> filter) =>
        from s in db.BoardSnapshots.AsNoTracking().Where(filter)
        join u in db.Users.AsNoTracking() on s.CreatedBy equals u.Subject into authors
        from author in authors.DefaultIfEmpty()
        select new Row(s, author == null ? null : author.DisplayName);

    private sealed record Row(BoardSnapshot Snapshot, string? Author);
}
