using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A user's role on a board. The pair (<see cref="BoardId"/>, <see cref="UserId"/>) is the key: a user
/// cannot hold two roles on one board.
/// </summary>
public class BoardMembership
{
    public Guid BoardId { get; set; }
    public Guid UserId { get; set; }
    public BoardRole Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Board? Board { get; set; }
    public User? User { get; set; }

    /// <summary>A membership of an existing board and user with a defined role.</summary>
    public static BoardMembership Create(Guid boardId, Guid userId, BoardRole role, DateTimeOffset createdAt)
    {
        Guard.Against.Default(boardId);
        Guard.Against.Default(userId);
        Guard.Against.EnumOutOfRange(role);
        return new BoardMembership { BoardId = boardId, UserId = userId, Role = role, CreatedAt = createdAt };
    }
}
