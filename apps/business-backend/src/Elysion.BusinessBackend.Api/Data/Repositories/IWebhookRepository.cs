using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>The webhook endpoints and their deliveries, the outbox (ADR 0033, #853).</summary>
public interface IWebhookRepository
{
    /// <summary>Stages a new endpoint; <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.</summary>
    void Add(WebhookEndpoint endpoint);

    /// <summary>Stages a delivery; it is committed with the change it is about.</summary>
    void Add(WebhookDelivery delivery);

    /// <summary>Stages the removal of an endpoint with its deliveries.</summary>
    void Remove(WebhookEndpoint endpoint);

    /// <summary>The endpoints of a board, or the instance-wide ones for null, oldest first; untracked copies.</summary>
    Task<IReadOnlyList<WebhookEndpoint>> ListAsync(Guid? boardId, CancellationToken cancellationToken);

    Task<int> CountAsync(Guid? boardId, CancellationToken cancellationToken);

    /// <summary>An endpoint of a board (or an instance-wide one for null) by id, tracked; null when there is no such one there.</summary>
    Task<WebhookEndpoint?> FindForUpdateAsync(Guid? boardId, Guid id, CancellationToken cancellationToken);

    /// <summary>The switched-on endpoints that hear about <paramref name="boardId"/>: its own and the instance-wide ones; untracked.</summary>
    Task<IReadOnlyList<WebhookEndpoint>> ListListeningAsync(Guid boardId, CancellationToken cancellationToken);

    /// <summary>Whether an event of <paramref name="eventType"/> for the board was put in the outbox after <paramref name="since"/>.</summary>
    Task<bool> HasEventSinceAsync(Guid boardId,
        string eventType,
        DateTimeOffset since,
        CancellationToken cancellationToken);

    /// <summary>The newest deliveries of an endpoint, newest first; untracked.</summary>
    Task<IReadOnlyList<WebhookDelivery>> ListDeliveriesAsync(Guid endpointId,
        int count,
        CancellationToken cancellationToken);

    /// <summary>A delivery of an endpoint, untracked, or null.</summary>
    Task<WebhookDelivery?> FindDeliveryAsync(Guid endpointId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// The pending deliveries due at <paramref name="now"/> of switched-on endpoints that no instance holds, oldest first, tracked
    /// with their endpoints; the caller takes each with a lease before it sends it.
    /// </summary>
    Task<IReadOnlyList<WebhookDelivery>> ListDueAsync(DateTimeOffset now,
        int count,
        CancellationToken cancellationToken);

    /// <summary>
    /// Takes a due delivery for this instance until <paramref name="until"/> and commits that at once: false when another instance
    /// took it first (its lease token changed), and then the row is forgotten here.
    /// </summary>
    Task<bool> TryLeaseAsync(WebhookDelivery delivery, DateTimeOffset until, CancellationToken cancellationToken);

    /// <summary>The pending deliveries of an endpoint, tracked (to fail them when the endpoint is switched off).</summary>
    Task<IReadOnlyList<WebhookDelivery>>
        ListPendingForUpdateAsync(Guid endpointId, CancellationToken cancellationToken);

    /// <summary>How many deliveries wait: the size of the outbox.</summary>
    Task<int> CountPendingAsync(CancellationToken cancellationToken);

    /// <summary>Removes (committed) the finished deliveries of an endpoint beyond its newest <paramref name="keep"/>.</summary>
    Task<int> TrimAsync(Guid endpointId, int keep, CancellationToken cancellationToken);

    /// <summary>Removes (committed) the endpoints whose board is gone and that have nothing left to send.</summary>
    Task<int> RemoveOrphansAsync(CancellationToken cancellationToken);
}
