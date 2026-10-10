using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class BoardUserStateRepository(ElysionDbContext db) : IBoardUserStateRepository
{
    public async Task<IReadOnlyDictionary<Guid, BoardUserState>> StatesAsync(
        Guid userId,
        IReadOnlyCollection<Guid> boardIds,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        if (boardIds.Count == 0)
        {
            return new Dictionary<Guid, BoardUserState>();
        }

        var visits = await db.BoardVisits.AsNoTracking()
            .Where(v => v.UserId == userId && boardIds.Contains(v.BoardId))
            .ToDictionaryAsync(v => v.BoardId, v => v.LastOpenedAt, cancellationToken);
        var favorites = await db.BoardFavorites.AsNoTracking()
            .Where(f => f.UserId == userId && boardIds.Contains(f.BoardId))
            .Select(f => f.BoardId)
            .ToListAsync(cancellationToken);
        var favoriteIds = favorites.ToHashSet();
        return visits.Keys.Concat(favoriteIds)
            .Distinct()
            .ToDictionary(
                id => id,
                id => new BoardUserState(visits.TryGetValue(id, out var opened) ? opened : null,
                    favoriteIds.Contains(id)));
    }

    public async Task<bool> RecordVisitAsync(
        Guid boardId,
        Guid userId,
        DateTimeOffset now,
        TimeSpan minInterval,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        Guard.Against.Default(userId);
        var visit = await db.BoardVisits.FindAsync([boardId, userId], cancellationToken);
        if (visit is null)
        {
            db.BoardVisits.Add(new BoardVisit { BoardId = boardId, UserId = userId, LastOpenedAt = now });
            return true;
        }

        if (now - visit.LastOpenedAt < minInterval)
        {
            return false;
        }

        visit.LastOpenedAt = now;
        return true;
    }

    public async Task SetFavoriteAsync(
        Guid boardId,
        Guid userId,
        bool favorite,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        Guard.Against.Default(userId);
        var existing = await db.BoardFavorites.FindAsync([boardId, userId], cancellationToken);
        if (favorite && existing is null)
        {
            db.BoardFavorites.Add(new BoardFavorite { BoardId = boardId, UserId = userId, CreatedAt = now });
        }
        else if (!favorite && existing is not null)
        {
            db.BoardFavorites.Remove(existing);
        }
    }
}
