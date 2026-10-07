using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>
/// Rooms. Reads return detached copies unless the name says otherwise; <see cref="Add"/> and <see cref="Remove"/>
/// only stage a change, <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.
/// </summary>
public interface IRoomRepository
{
    /// <summary>The rooms a user owns or is a member of, by name; a room of other people is not in the list.</summary>
    Task<IReadOnlyList<Room>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// The user's role in a room, or null when they have none (not a member, or no such room). The room's creator
    /// is an Owner even without a membership row.
    /// </summary>
    Task<BoardRole?> GetRoleAsync(Guid roomId, Guid userId, CancellationToken cancellationToken);

    /// <summary>One room, or null. A copy that is not tracked.</summary>
    Task<Room?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>One room, or null, tracked: a change to it is saved by the next commit.</summary>
    Task<Room?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken);

    void Add(Room room);

    void Remove(Room room);
}
