using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A user's role in a room. The pair (<see cref="RoomId"/>, <see cref="UserId"/>) is the key. The roles are the
/// board roles (<see cref="BoardRole"/>) on purpose: the room's role is what its members get on every board in
/// the room, one to one (ADR 0019).
/// </summary>
public class RoomMembership
{
    public Guid RoomId { get; set; }
    public Guid UserId { get; set; }
    public BoardRole Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Room? Room { get; set; }
    public User? User { get; set; }

    /// <summary>A membership of an existing room and user with a defined role.</summary>
    public static RoomMembership Create(Guid roomId, Guid userId, BoardRole role, DateTimeOffset createdAt)
    {
        Guard.Against.Default(roomId);
        Guard.Against.Default(userId);
        Guard.Against.EnumOutOfRange(role);
        return new RoomMembership { RoomId = roomId, UserId = userId, Role = role, CreatedAt = createdAt };
    }
}
