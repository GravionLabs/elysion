using System.Security.Claims;

using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// What the credential of a request says beyond who it is (ADR 0033): whether it was a personal access token, and its scopes. The one
/// place that reads these claims; handlers take <see cref="ICurrentUser"/>.
/// </summary>
public static class CallerCredential
{
    /// <summary>The realm role that makes a Keycloak client an integration (a service account) rather than a person.</summary>
    public const string IntegrationRole = "elysion-integration";

    public static bool IsAccessToken(ClaimsPrincipal principal) =>
        principal.Identities.Any(identity =>
            identity.AuthenticationType == AccessTokenAuthenticationHandler.SchemeName);

    public static bool IsIntegration(ClaimsPrincipal principal) =>
        !IsAccessToken(principal) && principal.IsInRole(IntegrationRole);

    public static Guid? AccessTokenIdOf(ClaimsPrincipal principal) =>
        IsAccessToken(principal)
        && Guid.TryParse(principal.FindFirst(AccessTokenAuthenticationHandler.TokenIdClaim)?.Value, out var id)
            ? id
            : null;

    /// <summary>
    /// The scopes of the caller: a personal access token's own; an integration's from the <c>scope</c> claim of its Keycloak token
    /// (unknown values such as <c>profile</c> are left out); every scope for a person's own Keycloak token, which can do what the
    /// person can anyway.
    /// </summary>
    public static IReadOnlyList<string> ScopesOf(ClaimsPrincipal principal, User user)
    {
        if (IsAccessToken(principal) || user.IsIntegration)
        {
            return AccessTokenScopes.Parse(string.Join(' ',
                principal.FindAll(AccessTokenAuthenticationHandler.ScopeClaim).Select(c => c.Value)));
        }

        return AccessTokenScopes.All;
    }
}
