using System.Buffers;
using System.Security.Cryptography;
using System.Text;

namespace Elysion.BusinessBackend.Api.AccessTokens;

/// <summary>
/// The secret of a personal access token (ADR 0033): <c>elp_</c> and 43 characters of <c>[0-9A-Za-z]</c> (more than 256 random bits),
/// stored only as its SHA-256. The prefix is registered for secret scanning (docs/security.md), so a token pasted into a repository
/// can be recognised. That many random bits need no slow hash: nobody can guess a token, and its hash cannot be reversed.
/// </summary>
public static class AccessTokenSecrets
{
    public const string Prefix = "elp_";
    public const int RandomLength = 43;

    /// <summary>The length of a whole token: <see cref="Prefix"/> and <see cref="RandomLength"/> characters.</summary>
    public const int Length = 47;

    /// <summary>How much of a token the lists show: the prefix and eight characters.</summary>
    public const int DisplayLength = 12;

    private const string Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private static readonly SearchValues<char> AlphabetValues = SearchValues.Create(Alphabet);

    public static string Generate() =>
        Prefix + string.Create(RandomLength,
            0,
            (chars, _) =>
            {
                for (var i = 0; i < chars.Length; i++)
                {
                    chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
                }
            });

    public static string Hash(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static string DisplayPrefix(string token) => token[..DisplayLength];

    /// <summary>Whether this can be a token at all; anything else is refused without asking the database.</summary>
    public static bool LooksValid(string? token) =>
        token is { Length: Length }
        && token.StartsWith(Prefix, StringComparison.Ordinal)
        && !token.AsSpan(Prefix.Length).ContainsAnyExcept(AlphabetValues);

    /// <summary>The token of an <c>Authorization: Bearer elp_...</c> header, or null when the header carries anything else.</summary>
    public static string? FromAuthorizationHeader(string? authorization)
    {
        const string bearer = "Bearer ";
        if (authorization is null || !authorization.StartsWith(bearer, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authorization[bearer.Length..].Trim();
        return token.StartsWith(Prefix, StringComparison.Ordinal) ? token : null;
    }
}
