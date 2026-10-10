using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>
/// Boards. Reads return detached copies unless the name says otherwise; <see cref="Add"/> and
/// <see cref="Remove"/> only stage a change, <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.
/// </summary>
public interface IBoardRepository
{
    /// <summary>
    /// The boards a user is a member of or owns, and the boards of the rooms they are in, the most recently
    /// created first. A board without an owner and without that user's membership or room is not in the list.
    /// </summary>
    Task<IReadOnlyList<Board>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// The user's role on a board, or null when they have none (not a member, or no such board). The board's
    /// owner is an Owner even without a membership row, so a board is usable before anybody was invited. When
    /// the board is in a room, the user's role in the room counts too, and the higher of the two wins.
    /// </summary>
    Task<BoardRole?> GetRoleAsync(Guid boardId, Guid userId, CancellationToken cancellationToken);

    /// <summary>One board, or null. A copy that is not tracked: changes to it are not saved.</summary>
    Task<Board?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>How many boards a user owns (boards shared with them do not count).</summary>
    Task<int> CountOwnedAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>Whether a board with this id exists.</summary>
    Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>One board, or null, tracked: a change to it is saved by the next commit.</summary>
    Task<Board?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>The boards in a room, tracked: used to take them out of the room before it is deleted.</summary>
    Task<IReadOnlyList<Board>> ListInRoomForUpdateAsync(Guid roomId, CancellationToken cancellationToken);

    void Add(Board board);

    void Remove(Board board);
}
