using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class RoomRepository(ElysionDbContext db) : IRoomRepository
{
    public async Task<IReadOnlyList<Room>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        return await db.Rooms
            .AsNoTracking()
            .Where(room => room.OwnerId == userId || room.Memberships.Any(m => m.UserId == userId))
            .OrderBy(room => room.Name)
            .ThenBy(room => room.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<BoardRole?> GetRoleAsync(Guid roomId, Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        Guard.Against.Default(userId);
        var room = await db.Rooms
            .AsNoTracking()
            .Where(r => r.Id == roomId)
            .Select(r => new
            {
                r.OwnerId,
                Role = r.Memberships.Where(m => m.UserId == userId).Select(m => (BoardRole?)m.Role).FirstOrDefault()
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (room is null)
        {
            return null;
        }

        return room.OwnerId == userId ? BoardRole.Owner : room.Role;
    }

    public async Task<Room?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Rooms.AsNoTracking().FirstOrDefaultAsync(room => room.Id == id, cancellationToken);
    }

    public async Task<Room?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Rooms.FirstOrDefaultAsync(room => room.Id == id, cancellationToken);
    }

    public void Add(Room room) => db.Rooms.Add(Guard.Against.Null(room));

    public void Remove(Room room) => db.Rooms.Remove(Guard.Against.Null(room));
}
