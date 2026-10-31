using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class WebhookRepository(ElysionDbContext db) : IWebhookRepository
{
    public void Add(WebhookEndpoint endpoint) => db.WebhookEndpoints.Add(Guard.Against.Null(endpoint));

    public void Add(WebhookDelivery delivery) => db.WebhookDeliveries.Add(Guard.Against.Null(delivery));

    public void Remove(WebhookEndpoint endpoint) => db.WebhookEndpoints.Remove(Guard.Against.Null(endpoint));

    public async Task<IReadOnlyList<WebhookEndpoint>> ListAsync(Guid? boardId, CancellationToken cancellationToken) =>
        (await db.WebhookEndpoints.AsNoTracking()
            .Where(e => e.BoardId == boardId)
            .ToListAsync(cancellationToken))
        .OrderBy(e => e.CreatedAt)
        .ThenBy(e => e.Id)
        .ToList();

    public Task<int> CountAsync(Guid? boardId, CancellationToken cancellationToken) =>
        db.WebhookEndpoints.CountAsync(e => e.BoardId == boardId, cancellationToken);

    public Task<WebhookEndpoint?> FindForUpdateAsync(Guid? boardId, Guid id, CancellationToken cancellationToken) =>
        db.WebhookEndpoints.FirstOrDefaultAsync(e => e.Id == id && e.BoardId == boardId, cancellationToken);

    public async Task<IReadOnlyList<WebhookEndpoint>> ListListeningAsync(Guid boardId,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        return await db.WebhookEndpoints.AsNoTracking()
            .Where(e => (e.BoardId == boardId || e.BoardId == null) && e.DisabledAt == null)
            .ToListAsync(cancellationToken);
    }

    public Task<bool> HasEventSinceAsync(Guid boardId,
        string eventType,
        DateTimeOffset since,
        CancellationToken cancellationToken) =>
        db.WebhookDeliveries.AnyAsync(d => d.BoardId == boardId && d.EventType == eventType && d.CreatedAt > since,
            cancellationToken);

    public async Task<IReadOnlyList<WebhookDelivery>> ListDeliveriesAsync(Guid endpointId,
        int count,
        CancellationToken cancellationToken)
    {
        Guard.Against.NegativeOrZero(count);
        // Ordered in memory: SQLite (the repository tests) cannot order by DateTimeOffset, and an endpoint keeps few rows.
        return (await db.WebhookDeliveries.AsNoTracking()
                .Where(d => d.EndpointId == endpointId)
                .ToListAsync(cancellationToken))
            .OrderByDescending(d => d.CreatedAt)
            .ThenByDescending(d => d.Id)
            .Take(count)
            .ToList();
    }

    public Task<WebhookDelivery?> FindDeliveryAsync(Guid endpointId, Guid id, CancellationToken cancellationToken) =>
        db.WebhookDeliveries.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id && d.EndpointId == endpointId, cancellationToken);

    public async Task<IReadOnlyList<WebhookDelivery>> ListDueAsync(DateTimeOffset now,
        int count,
        CancellationToken cancellationToken)
    {
        Guard.Against.NegativeOrZero(count);
        return await db.WebhookDeliveries
            .Include(d => d.Endpoint)
            .Where(d => d.Status == WebhookDeliveryStatus.Pending
                        && d.NextAttemptAt <= now
                        && (d.LeaseUntil == null || d.LeaseUntil < now)
                        && d.Endpoint!.DisabledAt == null)
            .OrderBy(d => d.NextAttemptAt)
            .Take(count)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> TryLeaseAsync(WebhookDelivery delivery,
        DateTimeOffset until,
        CancellationToken cancellationToken)
    {
        Guard.Against.Null(delivery);
        delivery.LeaseUntil = until;
        delivery.LeaseToken = Guid.NewGuid();
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.Entry(delivery).State = EntityState.Detached;
            return false;
        }
    }

    public async Task<IReadOnlyList<WebhookDelivery>> ListPendingForUpdateAsync(Guid endpointId,
        CancellationToken cancellationToken) =>
        await db.WebhookDeliveries
            .Where(d => d.EndpointId == endpointId && d.Status == WebhookDeliveryStatus.Pending)
            .ToListAsync(cancellationToken);

    public Task<int> CountPendingAsync(CancellationToken cancellationToken) =>
        db.WebhookDeliveries.CountAsync(d => d.Status == WebhookDeliveryStatus.Pending, cancellationToken);

    public async Task<int> TrimAsync(Guid endpointId, int keep, CancellationToken cancellationToken)
    {
        Guard.Against.Negative(keep);
        var rows = await db.WebhookDeliveries
            .Where(d => d.EndpointId == endpointId)
            .ToListAsync(cancellationToken);
        var doomed = rows
            .OrderByDescending(d => d.CreatedAt)
            .ThenByDescending(d => d.Id)
            .Skip(keep)
            .Where(d => d.Status != WebhookDeliveryStatus.Pending)
            .ToList();
        if (doomed.Count == 0)
        {
            return 0;
        }

        db.WebhookDeliveries.RemoveRange(doomed);
        await db.SaveChangesAsync(cancellationToken);
        return doomed.Count;
    }

    public async Task<int> RemoveOrphansAsync(CancellationToken cancellationToken)
    {
        var orphans = await db.WebhookEndpoints
            .Where(e => e.BoardId != null
                        && !db.Boards.Any(b => b.Id == e.BoardId)
                        && !db.WebhookDeliveries.Any(d =>
                            d.EndpointId == e.Id && d.Status == WebhookDeliveryStatus.Pending))
            .ToListAsync(cancellationToken);
        if (orphans.Count == 0)
        {
            return 0;
        }

        db.WebhookEndpoints.RemoveRange(orphans);
        await db.SaveChangesAsync(cancellationToken);
        return orphans.Count;
    }
}
