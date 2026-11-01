namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// The events a webhook can receive (ADR 0033, #853). <c>comment.created</c> of the ADR is not in v1: the backend stores a board as a
/// Yjs state it cannot decode, so it cannot tell a comment apart in a save.
/// </summary>
public static class WebhookEventTypes
{
    public const string BoardCreated = "board.created";
    public const string BoardRenamed = "board.renamed";
    public const string BoardDeleted = "board.deleted";

    /// <summary>The content changed: sent from the realtime service's saves, at most once a minute per board.</summary>
    public const string BoardContentChanged = "board.content.changed";

    public const string MemberAdded = "member.added";
    public const string MemberRemoved = "member.removed";
    public const string MemberRoleChanged = "member.role_changed";

    /// <summary>A person saved a version ("Save version"); automatic and "Before restore" versions send nothing.</summary>
    public const string SnapshotCreated = "snapshot.created";

    /// <summary>The "Send test event" button: sent to the one endpoint, never subscribed to.</summary>
    public const string Test = "webhook.test";

    /// <summary>Every event an endpoint can subscribe to, in the order they are stored and listed.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        BoardCreated, BoardRenamed, BoardDeleted, BoardContentChanged, MemberAdded, MemberRemoved, MemberRoleChanged,
        SnapshotCreated,
    ];

    public static bool IsKnown(string type) => All.Contains(type, StringComparer.Ordinal);

    /// <summary>The known events of a space-separated list, in the order of <see cref="All"/>, each once; empty means all.</summary>
    public static IReadOnlyList<string> Parse(string? events)
    {
        if (string.IsNullOrWhiteSpace(events))
        {
            return [];
        }

        var given = events.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return All.Where(type => given.Contains(type, StringComparer.Ordinal)).ToList();
    }

    public static string Format(IEnumerable<string> events) => string.Join(' ', Parse(string.Join(' ', events)));
}
