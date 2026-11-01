namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Who is calling, as a local user: the row for the token's subject, created or updated for this request.
/// Handlers and policies take this instead of reading claims themselves. Only available on endpoints that
/// require authentication (anonymous ones are not provisioned).
/// </summary>
public interface ICurrentUser
{
    Guid Id { get; }
    string Subject { get; }
    string DisplayName { get; }
    string? Email { get; }

    /// <summary>Whether the token has the realm role of an administrator (<c>OIDC_ADMIN_ROLE</c>). Says nothing about any board or room.</summary>
    bool IsAdministrator { get; }

    /// <summary>Whether the caller is an integration (a Keycloak service account, ADR 0033), not a person.</summary>
    bool IsIntegration { get; }

    /// <summary>The id of the personal access token the request came with, or null for a Keycloak token (ADR 0033).</summary>
    Guid? AccessTokenId { get; }

    /// <summary>
    /// What the caller may do on the public API (<see cref="AccessTokens.AccessTokenScopes"/>): a token's scopes, an integration's
    /// <c>scope</c> claim, every scope for a person's own Keycloak token.
    /// </summary>
    IReadOnlyList<string> Scopes { get; }
}
