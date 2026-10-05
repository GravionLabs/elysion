using Ardalis.GuardClauses;
using Elysion.BusinessBackend.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class BoardRepository(ElysionDbContext db) : IBoardRepository
{
    public async Task<IReadOnlyList<Board>> ListNewestFirstAsync(CancellationToken cancellationToken) =>
        await db.Boards.AsNoTracking().OrderByDescending(board => board.CreatedAt).ToListAsync(cancellationToken);

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
