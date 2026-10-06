using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class MembershipRepository(ElysionDbContext db) : IMembershipRepository
{
    public async Task<IReadOnlyList<BoardMembership>> ListForBoardAsync(Guid boardId,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        return await db.BoardMemberships
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.BoardId == boardId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.UserId)
            .ToListAsync(cancellationToken);
    }

    public async Task<BoardMembership?> FindForUpdateAsync(Guid boardId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        Guard.Against.Default(userId);
        return await db.BoardMemberships.FirstOrDefaultAsync(m => m.BoardId == boardId && m.UserId == userId,
            cancellationToken);
    }

    public void Add(BoardMembership membership) => db.BoardMemberships.Add(Guard.Against.Null(membership));

    public void Remove(BoardMembership membership) => db.BoardMemberships.Remove(Guard.Against.Null(membership));
}
