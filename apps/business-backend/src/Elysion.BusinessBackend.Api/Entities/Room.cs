using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A shared space for boards (ADR 0019): a name, an owner and members with roles. A board lives in at most one
/// room (<see cref="Board.RoomId"/>); the room's members get the room's role on its boards, in addition to what
/// the board's own memberships give. Deleting a room does not delete its boards: they leave the room.
/// </summary>
public class Room
{
    public const int MaxNameLength = 120;

    public Guid Id { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// The user who created the room. Null only when that user was deleted: a room does not go with its creator.
    /// As for a board's owner, the creator is an Owner of the room even without a membership row.
    /// </summary>
    public Guid? OwnerId { get; set; }

    public User? Owner { get; set; }

    public List<RoomMembership> Memberships { get; set; } = [];

    public List<Board> Boards { get; set; } = [];

    /// <summary>A room with a valid name, created by an existing user.</summary>
    public static Room Create(Guid id, string name, DateTimeOffset createdAt, Guid ownerId)
    {
        Guard.Against.Default(id);
        Guard.Against.Default(ownerId);
        Guard.Against.InvalidInput(name, nameof(name), candidate => TryNormalizeName(candidate, out _));

        _ = TryNormalizeName(name, out var normalized);
        return new Room { Id = id, Name = normalized, CreatedAt = createdAt, OwnerId = ownerId };
    }

    /// <summary>
    /// The single rule for a room name, the board's rule: trimmed, 1 to <see cref="MaxNameLength"/> characters.
    /// Request validation uses it to answer <c>400</c>; <see cref="Create"/> refuses what got past it.
    /// </summary>
    public static bool TryNormalizeName(string? raw, out string name)
    {
        name = raw?.Trim() ?? string.Empty;
        return name.Length is >= 1 and <= MaxNameLength;
    }
}
