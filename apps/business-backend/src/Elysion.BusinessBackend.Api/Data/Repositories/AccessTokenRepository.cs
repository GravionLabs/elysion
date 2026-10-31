using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class AccessTokenRepository(ElysionDbContext db) : IAccessTokenRepository
{
    public void Add(AccessToken token)
    {
        Guard.Against.Null(token);
        db.AccessTokens.Add(token);
    }

    public async Task<AccessTokenGrant?> FindGrantByHashAsync(string hash, CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(hash);
        var row = await db.AccessTokens.AsNoTracking()
            .Where(t => t.Hash == hash)
            .Select(t => new
            {
                t.Id,
                t.OwnerId,
                t.Owner!.Subject,
                t.Scopes,
                t.ExpiresAt,
                t.RevokedAt,
                t.LastUsedAt
            })
            .FirstOrDefaultAsync(cancellationToken);
        return row is null
            ? null
            : new AccessTokenGrant(row.Id,
                row.OwnerId,
                row.Subject,
                AccessTokenScopes.Parse(row.Scopes),
                row.ExpiresAt,
                row.RevokedAt,
                row.LastUsedAt);
    }

    public async Task<IReadOnlyList<AccessToken>> ListForOwnerAsync(Guid ownerId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(ownerId);
        return await db.AccessTokens.AsNoTracking()
            .Where(t => t.OwnerId == ownerId && t.RevokedAt == null)
            .OrderByDescending(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountActiveAsync(Guid ownerId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Guard.Against.Default(ownerId);
        // The few tokens of one person are compared in memory: SQLite (the repository tests) cannot compare DateTimeOffset.
        var expiries = await db.AccessTokens.AsNoTracking()
            .Where(t => t.OwnerId == ownerId && t.RevokedAt == null)
            .Select(t => t.ExpiresAt)
            .ToListAsync(cancellationToken);
        return expiries.Count(e => e > now);
    }

    public async Task<AccessToken?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.AccessTokens.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
    }

    public async Task MarkUsedAsync(Guid id, DateTimeOffset at, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        var token = await db.AccessTokens.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (token is null)
        {
            return;
        }

        token.LastUsedAt = at;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<PagedResult<AdminAccessTokenDto>> ListAllAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        Guard.Against.NegativeOrZero(page);
        Guard.Against.NegativeOrZero(pageSize);
        var tokens = db.AccessTokens.AsNoTracking().AsQueryable();
        var needle = string.IsNullOrWhiteSpace(query) ? null : query.Trim().ToLowerInvariant();
        if (needle is not null)
        {
            // `ToLower()` is translated to `lower(...)`; the overloads CA1862 asks for are not translated by EF Core.
#pragma warning disable CA1862
            tokens = tokens.Where(t => t.Name.ToLower().Contains(needle)
                                       || t.Prefix.ToLower().Contains(needle)
                                       || t.Owner!.DisplayName.ToLower().Contains(needle));
#pragma warning restore CA1862
        }

        var total = await tokens.CountAsync(cancellationToken);
        var rows = await tokens.OrderByDescending(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Prefix,
                t.Scopes,
                t.OwnerId,
                OwnerName = t.Owner!.DisplayName,
                t.CreatedAt,
                t.LastUsedAt,
                t.ExpiresAt,
                t.RevokedAt
            })
            .ToListAsync(cancellationToken);
        var items = rows.Select(r => new AdminAccessTokenDto(r.Id,
                r.Name,
                r.Prefix,
                AccessTokenScopes.Parse(r.Scopes),
                new AdminOwnerDto(r.OwnerId, r.OwnerName),
                r.CreatedAt,
                r.LastUsedAt,
                r.ExpiresAt,
                r.RevokedAt))
            .ToList();
        return new PagedResult<AdminAccessTokenDto>(items, total, page, pageSize);
    }
}
