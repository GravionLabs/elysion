using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class RoomMembershipRepository(ElysionDbContext db) : IRoomMembershipRepository
{
    public async Task<IReadOnlyList<RoomMembership>> ListForRoomAsync(Guid roomId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        return await db.RoomMemberships
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.RoomId == roomId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.UserId)
            .ToListAsync(cancellationToken);
    }

    public async Task<RoomMembership?> FindForUpdateAsync(Guid roomId, Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        Guard.Against.Default(userId);
        return await db.RoomMemberships.FirstOrDefaultAsync(m => m.RoomId == roomId && m.UserId == userId,
            cancellationToken);
    }

    public void Add(RoomMembership membership) => db.RoomMemberships.Add(Guard.Against.Null(membership));

    public void Remove(RoomMembership membership) => db.RoomMemberships.Remove(Guard.Against.Null(membership));
}
