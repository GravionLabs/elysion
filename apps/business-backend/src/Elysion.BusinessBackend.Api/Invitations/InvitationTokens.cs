using System.Security.Cryptography;
using System.Text;

namespace Elysion.BusinessBackend.Api.Invitations;

/// <summary>The token of an invitation link: 32 random bytes as base64url (43 characters), stored only as its SHA-256.</summary>
public static class InvitationTokens
{
    public const int TokenLength = 43;

    public static string Generate() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Whether this can be a token at all; anything else is unknown without asking the database.</summary>
    public static bool LooksValid(string? token) =>
        token is { Length: TokenLength } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
