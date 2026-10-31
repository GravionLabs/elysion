namespace Elysion.BusinessBackend.Api.Entities;

public enum WebhookDeliveryStatus
{
    /// <summary>Waiting for its (next) attempt.</summary>
    Pending,
    Succeeded,

    /// <summary>Retried for a day without success, or its endpoint was switched off.</summary>
    Failed,
}

/// <summary>
/// One event for one endpoint: the outbox (ADR 0033, #853). The row is written in the same transaction as the change it is about,
/// and <see cref="Webhooks.WebhookDeliveryService"/> posts it. The body is kept as it was made, so a retry and a "send again"
/// post the same event (receivers can tell a repeat by <see cref="EventId"/>). The newest
/// <see cref="Webhooks.WebhookDeliveryService.KeptPerEndpoint"/> finished ones per endpoint are kept for its owners.
/// </summary>
public class WebhookDelivery
{
    public const int MaxErrorLength = 300;
    public const int MaxEventTypeLength = 40;

    public Guid Id { get; set; }
    public Guid EndpointId { get; set; }
    public WebhookEndpoint? Endpoint { get; set; }

    public Guid EventId { get; set; }
    public required string EventType { get; set; }

    /// <summary>The board the event is about (null for a test event of an instance-wide endpoint).</summary>
    public Guid? BoardId { get; set; }

    /// <summary>The JSON body, exactly as it is posted.</summary>
    public required string Payload { get; set; }

    public WebhookDeliveryStatus Status { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public DateTimeOffset? LastAttemptAt { get; set; }

    /// <summary>The HTTP status of the last attempt, or null when no answer came (timeout, refused address).</summary>
    public int? ResponseStatus { get; set; }

    public int? DurationMs { get; set; }

    /// <summary>What went wrong in the last attempt, in a few words: never the URL, a header or the body.</summary>
    public string? Error { get; set; }

    /// <summary>
    /// Until when one instance of the backend owns the row (it is sending it). <see cref="LeaseToken"/> is a concurrency token, so
    /// two instances that try to take the same row cannot both succeed.
    /// </summary>
    public DateTimeOffset? LeaseUntil { get; set; }

    public Guid LeaseToken { get; set; }

    /// <summary>The error of a delivery that was given up because its endpoint was switched off.</summary>
    public const string SwitchedOffError = "Not sent: the endpoint was switched off.";

    /// <summary>
    /// Gives up a pending delivery because its endpoint was switched off (by the worker after a day of failures, or by a person). A new
    /// <see cref="LeaseToken"/> makes an instance that is sending it right now fail to save its outcome, so the row stays given up.
    /// </summary>
    public void GiveUpSwitchedOff()
    {
        Status = WebhookDeliveryStatus.Failed;
        Error = SwitchedOffError;
        LeaseUntil = null;
        LeaseToken = Guid.NewGuid();
    }
}
