namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>Body of <c>POST .../webhooks</c> (#853): the URL and the events (none: all of them).</summary>
public sealed record CreateWebhookRequest(string? Url, IReadOnlyList<string>? Events);

/// <summary>Body of <c>PATCH .../webhooks/{id}</c>: what is given changes; <c>Enabled: true</c> switches a disabled endpoint on again.</summary>
public sealed record UpdateWebhookRequest(string? Url, IReadOnlyList<string>? Events, bool? Enabled);

/// <summary>An endpoint as its owners see it: never its secret, only the secret's first characters.</summary>
public sealed record WebhookDto(
    Guid Id,
    Guid? BoardId,
    string Url,
    IReadOnlyList<string> Events,
    bool Enabled,
    DateTimeOffset? DisabledAt,
    string? DisabledReason,
    DateTimeOffset CreatedAt,
    string SecretPrefix);

/// <summary>The answer to making an endpoint: the one time its secret is shown.</summary>
public sealed record CreatedWebhookDto(
    Guid Id,
    Guid? BoardId,
    string Url,
    IReadOnlyList<string> Events,
    bool Enabled,
    DateTimeOffset? DisabledAt,
    string? DisabledReason,
    DateTimeOffset CreatedAt,
    string SecretPrefix,
    string Secret);

/// <summary>One delivery of an endpoint: its event, how it went and when; never the body or the receiver's answer.</summary>
public sealed record WebhookDeliveryDto(
    Guid Id,
    Guid EventId,
    string EventType,
    string Status,
    int Attempts,
    int? ResponseStatus,
    int? DurationMs,
    string? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastAttemptAt,
    DateTimeOffset? NextAttemptAt);
