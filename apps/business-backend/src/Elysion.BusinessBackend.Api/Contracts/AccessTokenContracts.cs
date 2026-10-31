namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>Body of <c>POST /access-tokens</c> (#851): a name, at least one scope and a lifetime of 1 to 365 days.</summary>
public sealed record CreateAccessTokenRequest(string? Name, IReadOnlyList<string>? Scopes, int? ExpiresInDays);

/// <summary>A personal access token in its owner's list: never the secret or its hash.</summary>
public sealed record AccessTokenDto(
    Guid Id,
    string Name,
    string Prefix,
    IReadOnlyList<string> Scopes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset ExpiresAt);

/// <summary>The answer to making a token: the one time the secret (<c>Token</c>) is shown.</summary>
public sealed record CreatedAccessTokenDto(
    Guid Id,
    string Name,
    string Prefix,
    IReadOnlyList<string> Scopes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset ExpiresAt,
    string Token);

/// <summary>
/// Who a credential is, for the BFF's guard of the public API (<c>GET /me/credential</c>, ADR 0033): the user, whether it is a
/// person or an integration, the id of the personal access token (null for a Keycloak token) and the scopes.
/// </summary>
public sealed record CredentialDto(
    Guid UserId,
    string DisplayName,
    string Kind,
    Guid? TokenId,
    IReadOnlyList<string> Scopes);
