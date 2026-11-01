using System.IdentityModel.Tokens.Jwt;
using System.Text;

using Microsoft.IdentityModel.Tokens;

namespace Elysion.BusinessBackend.Api.Voting;

/// <summary>
/// The service token of every call from the backend to an internal route of the realtime service (ADR 0017 mirrored, ADR 0029):
/// HS256, signed with the secret both services share. The values are the ones the realtime service checks.
/// </summary>
internal static class RealtimeServiceToken
{
    public const string Issuer = "elysion-business-backend";
    public const string Audience = "elysion-realtime";

    public static string Sign(string secret, DateTimeOffset now, TimeSpan lifetime)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        return new JwtSecurityTokenHandler().CreateEncodedJwt(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = (now + lifetime).UtcDateTime,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });
    }
}
