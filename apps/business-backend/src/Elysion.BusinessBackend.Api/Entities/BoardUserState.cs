namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// When a user last opened a board (#730). One row per user and board, written by <c>POST /boards/{id}/open</c> at most once per
/// <see cref="BoardUserStateRepositoryDefaults.VisitInterval"/> (a read never writes). It goes with the board and with the user.
/// </summary>
public class BoardVisit
{
    public Guid BoardId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset LastOpenedAt { get; set; }

    public Board? Board { get; set; }
    public User? User { get; set; }
}

/// <summary>A board a user marked with a star (#730). One row per user and board; it goes with the board and with the user.</summary>
public class BoardFavorite
{
    public Guid BoardId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Board? Board { get; set; }
    public User? User { get; set; }
}

/// <summary>What the person knows about a board that the board itself does not hold: when they opened it, and the star.</summary>
public readonly record struct BoardUserState(DateTimeOffset? LastOpenedAt, bool IsFavorite);

public static class BoardUserStateRepositoryDefaults
{
    /// <summary>A person's visit to a board is written at most this often: a reload is not a visit worth a write.</summary>
    public static readonly TimeSpan VisitInterval = TimeSpan.FromMinutes(5);
}
