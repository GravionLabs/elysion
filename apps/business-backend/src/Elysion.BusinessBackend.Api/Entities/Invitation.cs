namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// An invitation link of a board or a room (#734): whoever signs in and follows it gets <see cref="Role"/> unless they have
/// that role or a higher one already. The link's token is shown once, when the link is made; only its SHA-256
/// (<see cref="TokenHash"/>) is stored, so a copy of the database cannot be used to join a board. Exactly one of
/// <see cref="BoardId"/> and <see cref="RoomId"/> is set. An invitation goes with its board or room.
/// </summary>
public class Invitation
{
    /// <summary>The most active links one board or room may have at a time.</summary>
    public const int MaxActivePerTarget = 50;

    public const int MinHours = 1;
    public const int MaxHours = 30 * 24;
    public const int MaxUsesLimit = 1000;

    public Guid Id { get; set; }

    /// <summary>Lower-case hex SHA-256 of the token.</summary>
    public required string TokenHash { get; set; }

    public Guid? BoardId { get; set; }
    public Guid? RoomId { get; set; }

    /// <summary>Editor or Viewer; a link never makes an owner.</summary>
    public BoardRole Role { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>How many people may use the link, or null for no limit.</summary>
    public int? MaxUses { get; set; }

    /// <summary>How many times the link added or raised a membership. A concurrency token: two people using the last use cannot both get it.</summary>
    public int Uses { get; set; }

    public Guid CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }

    public Board? Board { get; set; }
    public Room? Room { get; set; }

    public bool IsActive(DateTimeOffset now) =>
        RevokedAt is null && now < ExpiresAt && (MaxUses is null || Uses < MaxUses);
}
