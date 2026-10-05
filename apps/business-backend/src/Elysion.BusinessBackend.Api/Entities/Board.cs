namespace Elysion.BusinessBackend.Api.Entities;

public class Board
{
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

    public List<BoardMembership> Memberships { get; set; } = [];
}
