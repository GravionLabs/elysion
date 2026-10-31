using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.AccessTokens;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A personal access token (ADR 0033, #851): a secret a person issues for a script, which acts as that person on the public API
/// with the token's <see cref="Scopes"/> and never sees more than the person. The secret is shown once, when it is made; only its
/// SHA-256 (<see cref="Hash"/>) is stored, so a copy of the database cannot be used to call the API. A token goes with its owner.
/// </summary>
public class AccessToken
{
    public const int MaxNameLength = 100;

    /// <summary>The longest a token may live: one year.</summary>
    public const int MaxLifetimeDays = 365;

    /// <summary>The most tokens one person may have that are neither revoked nor expired.</summary>
    public const int MaxActivePerOwner = 50;

    /// <summary>The least time between two writes of <see cref="LastUsedAt"/>.</summary>
    public static readonly TimeSpan UseInterval = TimeSpan.FromMinutes(1);

    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public User? Owner { get; set; }

    /// <summary>What the person called it ("CI sync"), to recognise it in the list.</summary>
    public required string Name { get; set; }

    /// <summary>The start of the secret (<c>elp_</c> and eight characters), shown in lists so a leaked token can be found.</summary>
    public required string Prefix { get; set; }

    /// <summary>Lower-case hex SHA-256 of the secret.</summary>
    public required string Hash { get; set; }

    /// <summary>The scopes, separated by a space, in the order of <see cref="AccessTokenScopes.All"/>.</summary>
    public required string Scopes { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>When the token was last used; written at most once per <see cref="UseInterval"/>. Null when it never was.</summary>
    public DateTimeOffset? LastUsedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }

    public IReadOnlyList<string> ScopeList => AccessTokenScopes.Parse(Scopes);

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && now < ExpiresAt;

    /// <summary>A token of <paramref name="ownerId"/> for the hash of a secret; the caller checked name, scopes and expiry.</summary>
    public static AccessToken Create(Guid id,
        Guid ownerId,
        string name,
        string prefix,
        string hash,
        IReadOnlyCollection<string> scopes,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt)
    {
        Guard.Against.Default(id);
        Guard.Against.Default(ownerId);
        Guard.Against.NullOrWhiteSpace(name);
        Guard.Against.InvalidInput(name, nameof(name), n => n.Trim().Length <= MaxNameLength);
        Guard.Against.NullOrWhiteSpace(prefix);
        Guard.Against.InvalidInput(hash, nameof(hash), h => h is { Length: 64 });
        Guard.Against.NullOrEmpty(scopes);
        Guard.Against.InvalidInput(scopes, nameof(scopes), s => s.All(AccessTokenScopes.IsKnown));
        Guard.Against.InvalidInput(expiresAt,
            nameof(expiresAt),
            e => e > createdAt && e <= createdAt.AddDays(MaxLifetimeDays));
        return new AccessToken
        {
            Id = id,
            OwnerId = ownerId,
            Name = name.Trim(),
            Prefix = prefix,
            Hash = hash,
            Scopes = AccessTokenScopes.Format(scopes),
            CreatedAt = createdAt,
            ExpiresAt = expiresAt,
        };
    }
}
