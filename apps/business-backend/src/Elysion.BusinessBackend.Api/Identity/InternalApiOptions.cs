using System.ComponentModel.DataAnnotations;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// How the realtime service proves who it is on the internal document API (ADR 0017): a short-lived JWT signed with a
/// secret the two services share. The values of the token's claims are the ones of <c>@elysion/shared-types</c>
/// (<c>internal-token.ts</c>); change them in both places.
/// </summary>
public sealed class InternalApiOptions
{
    public const string SecretSetting = "INTERNAL_API_SECRET";

    /// <summary>The authentication scheme that accepts this token, and only on the internal API.</summary>
    public const string Scheme = "Internal";

    /// <summary>The policy of the internal endpoints: authenticated by <see cref="Scheme"/>, nothing else.</summary>
    public const string Policy = "InternalService";

    public const string Issuer = "elysion-realtime";
    public const string Audience = "elysion-backend-internal";

    public const int MinSecretLength = 32;

    /// <summary>The HS256 secret both services have. Required: without it the service does not start.</summary>
    [Required, MinLength(MinSecretLength)]
    public string Secret { get; set; } = "";
}
