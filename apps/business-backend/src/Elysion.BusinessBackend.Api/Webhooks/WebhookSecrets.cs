using System.Buffers;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// The secret of a webhook endpoint and the signature it makes (ADR 0033, #853). A secret is <c>whsec_</c> and 43 characters of
/// <c>[0-9A-Za-z]</c> (more than 256 random bits). Every delivery carries
/// <c>Elysion-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256 of "&lt;t&gt;.&lt;body&gt;"&gt;</c>, keyed with the secret's
/// UTF-8 bytes; docs/webhooks.md shows a receiver how to check it.
/// </summary>
public static class WebhookSecrets
{
    public const string Prefix = "whsec_";
    public const int RandomLength = 43;
    public const int Length = 49;

    /// <summary>How much of a secret the lists show: the prefix and four characters, to tell two endpoints apart.</summary>
    public const int DisplayLength = 10;

    public const string SignatureHeader = "Elysion-Signature";

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

    public static bool LooksValid(string? secret) =>
        secret is { Length: Length }
        && secret.StartsWith(Prefix, StringComparison.Ordinal)
        && !secret.AsSpan(Prefix.Length).ContainsAnyExcept(AlphabetValues);

    public static string DisplayPrefix(string secret) => secret[..DisplayLength];

    /// <summary>The value of the <see cref="SignatureHeader"/> for <paramref name="body"/> sent at <paramref name="timestamp"/>.</summary>
    public static string Sign(string secret, long timestamp, string body)
    {
        var t = timestamp.ToString(CultureInfo.InvariantCulture);
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{t}.{body}"));
        return $"t={t},v1={Convert.ToHexStringLower(mac)}";
    }

    /// <summary>
    /// What a receiver does (and the tests): true when <paramref name="header"/> is a valid signature of <paramref name="body"/> made
    /// with <paramref name="secret"/> no more than <paramref name="tolerance"/> from <paramref name="now"/>.
    /// </summary>
    public static bool Verify(string secret, string header, string body, DateTimeOffset now, TimeSpan tolerance)
    {
        long? t = null;
        string? v1 = null;
        foreach (var part in header.Split(','))
        {
            var pair = part.Split('=', 2);
            if (pair.Length != 2)
                continue;
            if (pair[0].Trim() == "t" && long.TryParse(pair[1].Trim(), CultureInfo.InvariantCulture, out var value))
                t = value;
            else if (pair[0].Trim() == "v1")
                v1 = pair[1].Trim();
        }

        if (t is null || v1 is null || Math.Abs(now.ToUnixTimeSeconds() - t.Value) > tolerance.TotalSeconds)
        {
            return false;
        }

        var expected = Encoding.ASCII.GetBytes(Sign(secret, t.Value, body).Split(",v1=")[1]);
        return CryptographicOperations.FixedTimeEquals(expected, Encoding.ASCII.GetBytes(v1));
    }
}
