using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

public class Board
{
    public const int MaxNameLength = 120;

    public Guid Id { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// The user who created the board. Null for a board that existed before users did: it has no owner
    /// until the authorization rules (#117) say who gets it. A deleted user leaves their boards behind
    /// without an owner rather than taking them along.
    /// </summary>
    public Guid? OwnerId { get; set; }

    public User? Owner { get; set; }

    /// <summary>
    /// The room the board is in, or null (the state of every board made before rooms, and of boards made outside
    /// a room). Deleting the room sets this back to null; the board stays.
    /// </summary>
    public Guid? RoomId { get; set; }

    public Room? Room { get; set; }

    public List<BoardMembership> Memberships { get; set; } = [];

    /// <summary>
    /// A board with a valid name. Callers inside the service (the repositories, the endpoints after they
    /// validated the request) go through here, so no board with a blank or over-long name is ever stored.
    /// </summary>
    public static Board Create(Guid id, string name, DateTimeOffset createdAt, Guid? ownerId = null)
    {
        Guard.Against.Default(id);
        Guard.Against.InvalidInput(name, nameof(name), candidate => TryNormalizeName(candidate, out _));
        if (ownerId is { } owner)
        {
            Guard.Against.Default(owner, nameof(ownerId));
        }

        _ = TryNormalizeName(name, out var normalized);
        return new Board { Id = id, Name = normalized, CreatedAt = createdAt, OwnerId = ownerId };
    }

    /// <summary>
    /// The single rule for a board name: trimmed, 1 to <see cref="MaxNameLength"/> characters. Request
    /// validation uses it to answer <c>400</c> (user input is not a programming error, so no guard there);
    /// <see cref="Create"/> uses it to refuse anything that got past.
    /// </summary>
    public static bool TryNormalizeName(string? raw, out string name)
    {
        name = raw?.Trim() ?? string.Empty;
        return name.Length is >= 1 and <= MaxNameLength;
    }
}
