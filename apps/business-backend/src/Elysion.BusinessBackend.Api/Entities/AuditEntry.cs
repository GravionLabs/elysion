namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// One line of the audit log (#669): who changed who may see what. Append-only: nothing updates or deletes a row except the
/// retention job. It has no foreign keys on purpose, so that it outlives the person, group, room or board it is about.
/// </summary>
public sealed class AuditEntry
{
    public const int MaxActionLength = 64;
    public const int MaxSubjectTypeLength = 32;
    public const int MaxDetailsLength = 2000;
    public const int MaxRequestIdLength = 64;

    public Guid Id { get; init; }

    public DateTimeOffset At { get; init; }

    /// <summary>The person who did it; null when the system did (the nightly cleanup).</summary>
    public Guid? ActorUserId { get; init; }

    /// <summary>What happened, in the words of <c>AuditActions</c>.</summary>
    public string Action { get; init; } = "";

    /// <summary>What it happened to: <c>board</c>, <c>room</c>, <c>group</c> or <c>user</c>.</summary>
    public string SubjectType { get; init; } = "";

    public Guid? SubjectId { get; init; }

    /// <summary>A small JSON object: ids, roles, names of groups and counts. Never a token, an email address or what is on a board.</summary>
    public string? Details { get; init; }

    /// <summary>The request id of the structured logs (ADR 0025), so a log line and an entry find each other.</summary>
    public string? RequestId { get; init; }
}
