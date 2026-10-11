using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// The role a group has in a room: every member of the group gets it on the room and on its boards, next to the
/// roles they have as people (the highest counts, ADR 0019 and ADR 0027). The pair (<see cref="RoomId"/>, <see cref="GroupId"/>) is the key.
/// </summary>
public class RoomGroupMembership
{
    public Guid RoomId { get; set; }
    public Guid GroupId { get; set; }
    public BoardRole Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Room? Room { get; set; }
    public Group? Group { get; set; }

    public static RoomGroupMembership Create(Guid roomId, Guid groupId, BoardRole role, DateTimeOffset createdAt)
    {
        Guard.Against.Default(roomId);
        Guard.Against.Default(groupId);
        Guard.Against.EnumOutOfRange(role);
        return new RoomGroupMembership { RoomId = roomId, GroupId = groupId, Role = role, CreatedAt = createdAt };
    }
}
