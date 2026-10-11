using System.ComponentModel.DataAnnotations;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Where access tokens come from and who they are for (docs/specs/identity.md). Bound from configuration
/// under the names the other services use, so one set of environment variables describes the whole stack.
/// </summary>
public sealed class OidcOptions
{
    public const string IssuerSetting = "OIDC_ISSUER_URL";
    public const string AudienceSetting = "OIDC_AUDIENCE";
    public const string JwksUriSetting = "OIDC_JWKS_URI";
    public const string GroupsClaimSetting = "OIDC_GROUPS_CLAIM";
    public const string DefaultGroupsClaim = "groups";
    public const string AdminRoleSetting = "OIDC_ADMIN_ROLE";
    public const string DefaultAdminRole = "elysion-admin";

    /// <summary>The <c>iss</c> the tokens carry, e.g. <c>http://localhost:8081/realms/elysion</c>. Keys are found through its discovery document.</summary>
    [Required, Url]
    public string IssuerUrl { get; set; } = "";

    /// <summary>The <c>aud</c> a token must contain: <c>elysion-bff</c>.</summary>
    [Required]
    public string Audience { get; set; } = "";

    /// <summary>
    /// Where to fetch the signing keys when that differs from the issuer's address, which is the case inside
    /// the compose network (the issuer says <c>localhost:8081</c>, Keycloak is <c>keycloak:8080</c>). Empty:
    /// use the discovery document of the issuer.
    /// </summary>
    [Url]
    public string? JwksUri { get; set; }

    /// <summary>
    /// The multi-valued claim that carries the person's groups (ADR 0027), by default <c>groups</c>. Empty switches the sync off: no
    /// token changes any group membership. When it is set, a token without the claim means "no linked groups".
    /// </summary>
    public string GroupsClaim { get; set; } = DefaultGroupsClaim;

    /// <summary>
    /// The realm role (an entry of <c>realm_access.roles</c> in the access token) that makes a person an administrator of the
    /// instance (ADR 0027), by default <c>elysion-admin</c>. Empty: nobody is. It opens the <c>/admin</c> area and nothing else:
    /// it never gives a role on a board or a room.
    /// </summary>
    public string AdminRole { get; set; } = DefaultAdminRole;
}
