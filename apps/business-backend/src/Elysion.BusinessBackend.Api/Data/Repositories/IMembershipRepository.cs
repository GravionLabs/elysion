using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>The memberships of boards. <see cref="Add"/> and <see cref="Remove"/> stage; the unit of work commits.</summary>
public interface IMembershipRepository
{
    /// <summary>All memberships of a board with their users, in the order they were given; untracked copies.</summary>
    Task<IReadOnlyList<BoardMembership>> ListForBoardAsync(Guid boardId, CancellationToken cancellationToken);

    /// <summary>One membership, or null; tracked, so a change is saved by the next commit.</summary>
    Task<BoardMembership?> FindForUpdateAsync(Guid boardId, Guid userId, CancellationToken cancellationToken);

    void Add(BoardMembership membership);

    void Remove(BoardMembership membership);
}
