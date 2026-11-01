using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>A snapshot with the display name of its author (null for an automatic one or an unknown subject).</summary>
public readonly record struct SnapshotListing(BoardSnapshot Snapshot, string? Author);

/// <summary>
/// The metadata of board snapshots (ADR 0032). <see cref="Add"/> and <see cref="Remove"/> stage,
/// <see cref="IUnitOfWork.SaveChangesAsync"/> commits.
/// </summary>
public interface IBoardSnapshotRepository
{
    /// <summary>The board's snapshots, newest first.</summary>
    Task<IReadOnlyList<SnapshotListing>> ListNewestFirstAsync(Guid boardId, CancellationToken cancellationToken);

    Task<SnapshotListing?> FindAsync(Guid boardId, Guid snapshotId, CancellationToken cancellationToken);

    /// <summary>A tracked entity to change or remove.</summary>
    Task<BoardSnapshot?> FindForUpdateAsync(Guid boardId, Guid snapshotId, CancellationToken cancellationToken);

    /// <summary>When the board's newest snapshot of any kind was made, or null.</summary>
    Task<DateTimeOffset?> NewestAtAsync(Guid boardId, CancellationToken cancellationToken);

    /// <summary>How many manual (or, with <paramref name="manual"/> false, automatic) snapshots the board has.</summary>
    Task<int> CountAsync(Guid boardId, bool manual, CancellationToken cancellationToken);

    /// <summary>The automatic snapshots (not manual) beyond the newest <paramref name="keep"/>, tracked, oldest first.</summary>
    Task<IReadOnlyList<BoardSnapshot>>
        AutomaticBeyondAsync(Guid boardId, int keep, CancellationToken cancellationToken);

    /// <summary>Up to <paramref name="take"/> automatic snapshots (not manual) made before <paramref name="cutoff"/>, tracked, oldest first.</summary>
    Task<IReadOnlyList<BoardSnapshot>> AutomaticOlderThanAsync(DateTimeOffset cutoff,
        int take,
        CancellationToken cancellationToken);

    /// <summary>The ids of all snapshots of a board, for finding objects without a row.</summary>
    Task<IReadOnlySet<Guid>> IdsAsync(Guid boardId, CancellationToken cancellationToken);

    void Add(BoardSnapshot snapshot);

    void Remove(BoardSnapshot snapshot);
}
