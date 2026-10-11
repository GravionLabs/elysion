using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class OwnershipRepository(ElysionDbContext db) : IOwnershipRepository
{
    public async Task<IReadOnlyList<Board>> BoardsOwnedByAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        return await db.Boards.Include(b => b.Memberships)
            .Where(b => b.OwnerId == userId
                        || b.Memberships.Any(m => m.UserId == userId && m.Role == BoardRole.Owner))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Room>> RoomsOwnedByAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        return await db.Rooms.Include(r => r.Memberships)
            .Where(r => r.OwnerId == userId
                        || r.Memberships.Any(m => m.UserId == userId && m.Role == BoardRole.Owner))
            .ToListAsync(cancellationToken);
    }
}
