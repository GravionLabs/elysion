using System.Security.Claims;
using System.Text.Json;

using Microsoft.AspNetCore.Authentication;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Keycloak puts the realm roles of a person in the claim <c>realm_access</c>, a JSON object <c>{"roles":["a","b"]}</c>. This turns each
/// role into a plain <see cref="ClaimTypes.Role"/> claim, so that policies and tests can use <c>IsInRole</c> (ADR 0027). Authentication
/// runs it more than once per request; the added identity marks the principal as done.
/// </summary>
public sealed class RealmRolesClaimsTransformation : IClaimsTransformation
{
    public const string RealmAccessClaim = "realm_access";
    public const string AuthenticationType = "elysion.realm-roles";

    /// <summary>The most roles read from one token; more are ignored (a token that long is a misconfiguration).</summary>
    private const int MaxRoles = 200;

    public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identities.Any(identity => identity.AuthenticationType == AuthenticationType))
        {
            return Task.FromResult(principal);
        }

        var roles = ReadRoles(principal.FindFirst(RealmAccessClaim)?.Value);
        if (roles.Count == 0)
        {
            return Task.FromResult(principal);
        }

        var identity = new ClaimsIdentity(roles.Select(role => new Claim(ClaimTypes.Role, role)), AuthenticationType);
        var transformed = new ClaimsPrincipal(principal.Identities);
        transformed.AddIdentity(identity);
        return Task.FromResult(transformed);
    }

    /// <summary>The role names of a <c>realm_access</c> value; anything that is not the expected shape yields none.</summary>
    internal static IReadOnlyList<string> ReadRoles(string? realmAccess)
    {
        if (string.IsNullOrWhiteSpace(realmAccess))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(realmAccess);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("roles", out var roles)
                || roles.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return roles.EnumerateArray()
                .Where(role => role.ValueKind == JsonValueKind.String)
                .Select(role => role.GetString()!)
                .Where(role => !string.IsNullOrWhiteSpace(role))
                .Distinct(StringComparer.Ordinal)
                .Take(MaxRoles)
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
