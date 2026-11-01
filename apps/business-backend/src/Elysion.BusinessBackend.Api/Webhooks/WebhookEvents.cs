using System.Text.Json;

using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// Puts events into the outbox (ADR 0033, #853). Like <see cref="Audit.IAuditLog"/> it only <b>stages</b> the deliveries on the
/// request's unit of work, so they are committed with the change they are about: no event without the change, no change without
/// its event. Nothing is sent here: <see cref="WebhookDeliveryService"/> does that, so a slow receiver never slows a request.
/// </summary>
public interface IWebhookEvents
{
    /// <summary>
    /// Stages <paramref name="eventType"/> about <paramref name="boardId"/> for every switched-on endpoint that hears about the board
    /// and subscribed to it. <paramref name="data"/> is what changed (a name, a role): ids and names, never the board's content.
    /// </summary>
    Task RaiseAsync(string eventType,
        Guid boardId,
        object? data,
        CancellationToken cancellationToken,
        Guid? actorId = null);

    /// <summary>
    /// <see cref="WebhookEventTypes.BoardContentChanged"/> for a save of the realtime service, unless one was staged for the board in
    /// the last <see cref="ContentChangedInterval"/>.
    /// </summary>
    Task RaiseContentChangedAsync(Guid boardId, long version, CancellationToken cancellationToken);

    /// <summary>Stages a <see cref="WebhookEventTypes.Test"/> event for one endpoint and returns its delivery.</summary>
    WebhookDelivery StageTest(WebhookEndpoint endpoint);

    /// <summary>Stages a new delivery of the same event (same id and body) to the same endpoint: "Send again".</summary>
    WebhookDelivery StageRedelivery(WebhookDelivery delivery);
}

public sealed class WebhookEvents(IWebhookRepository webhooks, ICurrentUser currentUser, TimeProvider time)
    : IWebhookEvents
{
    /// <summary>The least time between two <c>board.content.changed</c> of one board.</summary>
    public static readonly TimeSpan ContentChangedInterval = TimeSpan.FromMinutes(1);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task RaiseAsync(string eventType,
        Guid boardId,
        object? data,
        CancellationToken cancellationToken,
        Guid? actorId = null)
    {
        Guard.Against.InvalidInput(eventType, nameof(eventType), WebhookEventTypes.IsKnown);
        Guard.Against.Default(boardId);
        var endpoints = (await webhooks.ListListeningAsync(boardId, cancellationToken))
            .Where(e => e.Receives(eventType))
            .ToList();
        if (endpoints.Count == 0)
        {
            return;
        }

        var now = time.GetUtcNow();
        var eventId = Guid.CreateVersion7();
        var payload = Payload(eventId, eventType, now, boardId, actorId ?? Actor(), data);
        foreach (var endpoint in endpoints)
        {
            webhooks.Add(NewDelivery(endpoint.Id, eventId, eventType, boardId, payload, now));
        }
    }

    public async Task RaiseContentChangedAsync(Guid boardId, long version, CancellationToken cancellationToken)
    {
        var since = time.GetUtcNow() - ContentChangedInterval;
        if (await webhooks.HasEventSinceAsync(boardId,
                WebhookEventTypes.BoardContentChanged,
                since,
                cancellationToken))
        {
            return;
        }

        await RaiseAsync(WebhookEventTypes.BoardContentChanged, boardId, new { version }, cancellationToken);
    }

    public WebhookDelivery StageTest(WebhookEndpoint endpoint)
    {
        Guard.Against.Null(endpoint);
        var now = time.GetUtcNow();
        var eventId = Guid.CreateVersion7();
        var payload = Payload(eventId,
            WebhookEventTypes.Test,
            now,
            endpoint.BoardId,
            Actor(),
            new { webhookId = endpoint.Id });
        var delivery = NewDelivery(endpoint.Id, eventId, WebhookEventTypes.Test, endpoint.BoardId, payload, now);
        webhooks.Add(delivery);
        return delivery;
    }

    public WebhookDelivery StageRedelivery(WebhookDelivery delivery)
    {
        Guard.Against.Null(delivery);
        var again = NewDelivery(delivery.EndpointId,
            delivery.EventId,
            delivery.EventType,
            delivery.BoardId,
            delivery.Payload,
            time.GetUtcNow());
        webhooks.Add(again);
        return again;
    }

    private static WebhookDelivery NewDelivery(Guid endpointId,
        Guid eventId,
        string eventType,
        Guid? boardId,
        string payload,
        DateTimeOffset now) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            EndpointId = endpointId,
            EventId = eventId,
            EventType = eventType,
            BoardId = boardId,
            Payload = payload,
            Status = WebhookDeliveryStatus.Pending,
            CreatedAt = now,
            NextAttemptAt = now,
            LeaseToken = Guid.NewGuid(),
        };

    /// <summary>The body every receiver gets: event id, type, time, board, actor and what changed (ADR 0033).</summary>
    private static string Payload(Guid eventId,
        string eventType,
        DateTimeOffset at,
        Guid? boardId,
        Guid? actorId,
        object? data) =>
        JsonSerializer.Serialize(new
            {
                id = eventId,
                type = eventType,
                occurredAt = at,
                boardId,
                actorId,
                data = data ?? new { },
            },
            Json);

    private Guid? Actor()
    {
        try
        {
            return currentUser.Id;
        }
        catch (InvalidOperationException)
        {
            return null; // the realtime service's save, or a background job: no person did it
        }
    }
}
