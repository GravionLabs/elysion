using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Webhooks;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A receiver of webhooks (ADR 0033, #853): the events of one board (registered by its owners), or of every board when
/// <see cref="BoardId"/> is null (registered by an administrator). The secret signs every delivery; it is shown once, when the
/// endpoint is made, and kept here because signing needs it (it is never logged or returned again).
/// </summary>
/// <remarks>
/// There is no foreign key to the board: a board's endpoints outlive it until its <c>board.deleted</c> was delivered, then
/// <see cref="WebhookDeliveryService"/> removes them.
/// </remarks>
public class WebhookEndpoint
{
    public const int MaxUrlLength = 2000;
    public const int MaxReasonLength = 500;

    /// <summary>The most endpoints one board may have, and the most instance-wide ones.</summary>
    public const int MaxPerBoard = 10;

    public Guid Id { get; set; }

    /// <summary>The board whose events this receives, or null for every board.</summary>
    public Guid? BoardId { get; set; }

    public required string Url { get; set; }

    /// <summary>The subscribed events, separated by a space, in the order of <see cref="WebhookEventTypes.All"/>; empty: all of them.</summary>
    public required string Events { get; set; }

    public required string Secret { get; set; }

    public Guid? CreatedById { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>When the endpoint was switched off (by a person, or after a day of failures); null while it is on.</summary>
    public DateTimeOffset? DisabledAt { get; set; }

    /// <summary>Why it is off, for its owners.</summary>
    public string? DisabledReason { get; set; }

    /// <summary>The first failed attempt since the last success; null while deliveries succeed.</summary>
    public DateTimeOffset? FailingSince { get; set; }

    public IReadOnlyList<string> EventList => WebhookEventTypes.Parse(Events);

    /// <summary>Whether an event of this type goes here.</summary>
    public bool Receives(string type) => Events.Length == 0 || EventList.Contains(type, StringComparer.Ordinal);

    public static WebhookEndpoint Create(Guid id,
        Guid? boardId,
        string url,
        IReadOnlyCollection<string> events,
        string secret,
        Guid? createdById,
        DateTimeOffset createdAt)
    {
        Guard.Against.Default(id);
        Guard.Against.NullOrWhiteSpace(url);
        Guard.Against.InvalidInput(url, nameof(url), u => u.Length <= MaxUrlLength);
        Guard.Against.Null(events);
        Guard.Against.InvalidInput(events, nameof(events), e => e.All(WebhookEventTypes.IsKnown));
        Guard.Against.InvalidInput(secret, nameof(secret), WebhookSecrets.LooksValid);
        return new WebhookEndpoint
        {
            Id = id,
            BoardId = boardId,
            Url = url,
            Events = WebhookEventTypes.Format(events),
            Secret = secret,
            CreatedById = createdById,
            CreatedAt = createdAt,
        };
    }
}
