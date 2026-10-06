using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class BoardRepository(ElysionDbContext db) : IBoardRepository
{
    public async Task<IReadOnlyList<Board>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        return await db.Boards
            .AsNoTracking()
            .Where(board => board.OwnerId == userId || board.Memberships.Any(m => m.UserId == userId))
            .OrderByDescending(board => board.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<BoardRole?> GetRoleAsync(Guid boardId, Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        Guard.Against.Default(userId);
        var board = await db.Boards
            .AsNoTracking()
            .Where(b => b.Id == boardId)
            .Select(b => new
            {
                b.OwnerId,
                Role = b.Memberships.Where(m => m.UserId == userId).Select(m => (BoardRole?)m.Role).FirstOrDefault()
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (board is null)
        {
            return null;
        }

        return board.OwnerId == userId ? BoardRole.Owner : board.Role;
    }

    public async Task<Board?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Boards.AsNoTracking().FirstOrDefaultAsync(board => board.Id == id, cancellationToken);
    }

    public async Task<Board?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Boards.FirstOrDefaultAsync(board => board.Id == id, cancellationToken);
    }

    public void Add(Board board) => db.Boards.Add(Guard.Against.Null(board));

    public void Remove(Board board) => db.Boards.Remove(Guard.Against.Null(board));
}
