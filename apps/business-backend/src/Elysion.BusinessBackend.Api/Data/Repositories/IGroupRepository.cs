using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>A group of a room with its role and a name for it.</summary>
public sealed record RoomGroupRole(Guid GroupId, string GroupName, BoardRole Role);

/// <summary>
/// Groups, their members and their roles on rooms (ADR 0027). Reads return detached copies; the writers stage changes
/// and <see cref="IUnitOfWork.SaveChangesAsync"/> commits them.
/// </summary>
public interface IGroupRepository
{
    Task<Group?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>A group by id, or null; tracked, so a change is saved by the next commit.</summary>
    Task<Group?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Groups whose name contains the text (ignoring case), by name; at most <paramref name="limit"/>.</summary>
    Task<IReadOnlyList<Group>> SearchAsync(string query, int limit, CancellationToken cancellationToken);

    /// <summary>The groups a person is in, by name.</summary>
    Task<IReadOnlyList<Group>> GetForUserAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>The linked groups with these external ids (those that exist), untracked.</summary>
    Task<IReadOnlyList<Group>> FindByExternalIdsAsync(IReadOnlyCollection<string> externalIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// Makes the person's memberships in <b>linked</b> groups exactly those of <paramref name="externalIds"/>: a group that does not
    /// exist yet is created (named after its id), missing memberships are added, others are removed; memberships in local
    /// groups are not touched. Commits. Returns whether anything changed. <paramref name="onChange"/> is called with (added, removed)
    /// after the change is staged and before it is saved, so that an audit entry goes into the same commit.
    /// </summary>
    Task<bool> SetLinkedMembershipsAsync(Guid userId,
        IReadOnlyCollection<string> externalIds,
        DateTimeOffset now,
        Action<int, int>? onChange,
        CancellationToken cancellationToken);

    /// <summary>Adds a person to a group (a local one in practice); false when they are in it already. Stages.</summary>
    Task<bool> AddMemberAsync(Guid groupId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Takes a person out of a group; false when they were not in it. Stages.</summary>
    Task<bool> RemoveMemberAsync(Guid groupId, Guid userId, CancellationToken cancellationToken);

    void Add(Group group);

    void Remove(Group group);

    /// <summary>The groups that have a role in a room, by name.</summary>
    Task<IReadOnlyList<RoomGroupRole>> ListForRoomAsync(Guid roomId, CancellationToken cancellationToken);

    /// <summary>Gives a group a role in a room, or changes it. Stages.</summary>
    Task SetRoomRoleAsync(Guid roomId,
        Guid groupId,
        BoardRole role,
        DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>Takes a group's role away from a room; false when it had none. Stages.</summary>
    Task<bool> RemoveRoomRoleAsync(Guid roomId, Guid groupId, CancellationToken cancellationToken);
}
