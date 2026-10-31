namespace Elysion.BusinessBackend.Api.AccessTokens;

/// <summary>
/// What a caller of the public API may do (ADR 0033). A personal access token has the scopes it was made with; an integration the
/// ones of its Keycloak token's <c>scope</c> claim; a person's own Keycloak token has all of them (it can do everything the
/// person can anyway). The BFF checks the scope a public route needs; the roles on boards and rooms apply as for everybody.
/// </summary>
public static class AccessTokenScopes
{
    public const string BoardsRead = "boards:read";
    public const string BoardsWrite = "boards:write";
    public const string MembersWrite = "members:write";
    public const string SnapshotsWrite = "snapshots:write";
    public const string WebhooksWrite = "webhooks:write";

    /// <summary>Every scope, in the order they are stored and listed.</summary>
    public static readonly IReadOnlyList<string> All =
        [BoardsRead, BoardsWrite, MembersWrite, SnapshotsWrite, WebhooksWrite];

    public static bool IsKnown(string scope) => All.Contains(scope, StringComparer.Ordinal);

    /// <summary>
    /// The known scopes of a space-separated list (a stored token, or the <c>scope</c> claim, which also carries Keycloak's own
    /// <c>profile</c> and <c>email</c>), in the order of <see cref="All"/>, each once.
    /// </summary>
    public static IReadOnlyList<string> Parse(string? scopes)
    {
        if (string.IsNullOrWhiteSpace(scopes))
        {
            return [];
        }

        var given = scopes.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return All.Where(scope => given.Contains(scope, StringComparer.Ordinal)).ToList();
    }

    /// <summary>The known scopes as one space-separated text, in the order of <see cref="All"/>, each once.</summary>
    public static string Format(IEnumerable<string> scopes) => string.Join(' ', Parse(string.Join(' ', scopes)));
}
