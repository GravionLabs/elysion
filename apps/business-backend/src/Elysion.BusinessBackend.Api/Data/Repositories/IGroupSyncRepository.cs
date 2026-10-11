using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>What one group's sync changed.</summary>
public sealed record GroupSyncResult(
    bool Renamed,
    int Added,
    int Removed,
    int PendingAdded,
    int PendingRemoved)
{
    public bool Changed => Renamed || Added > 0 || Removed > 0 || PendingAdded > 0 || PendingRemoved > 0;
}

/// <summary>The writes of the Graph group sync (#667) and the adoption of pending members at a first sign-in.</summary>
public interface IGroupSyncRepository
{
    /// <summary>The linked groups whose external id is a GUID (what Graph can look up), untracked.</summary>
    Task<IReadOnlyList<Group>> ListLinkedAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Makes the group agree with the directory, in one commit: the name (unless an administrator named it), the memberships the sync made
    /// before (<see cref="GroupMembership.FromGraph"/>) and the pending members. People known by their email get a real membership
    /// (added when missing, removed when the directory no longer lists them and the membership was the sync's own); a person who
    /// is not known yet becomes pending; a deactivated person is neither. Memberships that came from a token or an administrator are not
    /// touched. <paramref name="onChange"/> is called with the result before it is saved, so that an audit entry goes into the same commit.
    /// </summary>
    Task<GroupSyncResult> ApplyAsync(Guid groupId,
        string? directoryName,
        IReadOnlyCollection<GraphMember> members,
        DateTimeOffset now,
        Action<GroupSyncResult>? onChange,
        CancellationToken cancellationToken);

    /// <summary>
    /// Turns the pending memberships of a person's email into real ones (a first sign-in); returns how many were made. Stages and commits.
    /// </summary>
    Task<int> AdoptPendingAsync(Guid userId, string email, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Forgets the pending members of a group (it is not linked any more). Stages.</summary>
    Task ClearPendingAsync(Guid groupId, CancellationToken cancellationToken);
}
