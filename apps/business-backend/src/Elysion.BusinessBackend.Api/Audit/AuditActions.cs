namespace Elysion.BusinessBackend.Api.Audit;

/// <summary>The words of the audit log (#669). The subject types are <c>board</c>, <c>room</c>, <c>group</c> and <c>user</c>.</summary>
public static class AuditActions
{
    public const string Board = "board";
    public const string Room = "room";
    public const string Group = "group";
    public const string User = "user";

    public const string MemberAdded = "member.added";
    public const string MemberRoleChanged = "member.role_changed";
    public const string MemberRemoved = "member.removed";

    public const string RoomGroupRoleSet = "room.group_role_set";
    public const string RoomGroupRoleRemoved = "room.group_role_removed";

    public const string GroupCreated = "group.created";
    public const string GroupRenamed = "group.renamed";
    public const string GroupLinked = "group.linked";
    public const string GroupUnlinked = "group.unlinked";
    public const string GroupDeleted = "group.deleted";
    public const string GroupMemberAdded = "group.member_added";
    public const string GroupMemberRemoved = "group.member_removed";

    /// <summary>The groups of a person from the identity provider changed with their sign-in: one entry per change, not per request.</summary>
    public const string GroupsSynced = "groups.synced";

    /// <summary>The Graph sync changed a linked group (#667): its name, its members or its pending members. Written by the system, one entry per changed group.</summary>
    public const string GroupGraphSynced = "group.graph_synced";

    public const string UserDeactivated = "user.deactivated";
    public const string UserReactivated = "user.reactivated";

    /// <summary>
    /// The ownership of a board or room moved from one person to another by an administrator (#668); <c>userId</c> in the details is
    /// the new owner (the log shows them as the person it is about), <c>fromUserId</c> the previous one.
    /// </summary>
    public const string OwnerTransferred = "owner.transferred";

    /// <summary>A snapshot (a version) of a board was deleted by an owner (ADR 0032); details: <c>snapshotId</c>, <c>kind</c>.</summary>
    public const string SnapshotDeleted = "snapshot.deleted";

    /// <summary>A board was restored to a snapshot (#847); details: <c>snapshotId</c>.</summary>
    public const string SnapshotRestored = "snapshot.restored";

    public const string InvitationCreated = "invitation.created";
    public const string InvitationRevoked = "invitation.revoked";
    public const string InvitationAccepted = "invitation.accepted";
}
