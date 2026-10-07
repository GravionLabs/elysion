using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>The memberships of rooms. <see cref="Add"/> and <see cref="Remove"/> stage; the unit of work commits.</summary>
public interface IRoomMembershipRepository
{
    /// <summary>All memberships of a room with their users, in the order they were given; untracked copies.</summary>
    Task<IReadOnlyList<RoomMembership>> ListForRoomAsync(Guid roomId, CancellationToken cancellationToken);

    /// <summary>One membership, or null; tracked, so a change is saved by the next commit.</summary>
    Task<RoomMembership?> FindForUpdateAsync(Guid roomId, Guid userId, CancellationToken cancellationToken);

    void Add(RoomMembership membership);

    void Remove(RoomMembership membership);
}
