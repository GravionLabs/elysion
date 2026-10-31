using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>What a request needs to know about a token to let it in: its id, its owner's subject and its state.</summary>
public sealed record AccessTokenGrant(
    Guid Id,
    Guid OwnerId,
    string OwnerSubject,
    IReadOnlyList<string> Scopes,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RevokedAt,
    DateTimeOffset? LastUsedAt);

/// <summary>The personal access tokens (#851). The secret is never here: only its hash.</summary>
public interface IAccessTokenRepository
{
    /// <summary>Stages a new token; <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.</summary>
    void Add(AccessToken token);

    /// <summary>The token with this hash and its owner's subject, or null; whether it is still usable is the caller's question.</summary>
    Task<AccessTokenGrant?> FindGrantByHashAsync(string hash, CancellationToken cancellationToken);

    /// <summary>A person's tokens that are not revoked, newest first; untracked copies (expired ones are listed, as expired).</summary>
    Task<IReadOnlyList<AccessToken>> ListForOwnerAsync(Guid ownerId, CancellationToken cancellationToken);

    /// <summary>How many tokens a person has that are neither revoked nor expired at <paramref name="now"/>.</summary>
    Task<int> CountActiveAsync(Guid ownerId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>A token by id, or null; tracked, so a change is saved by the next commit.</summary>
    Task<AccessToken?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Writes when the token was last used; commits at once (it is not part of any other change).</summary>
    Task MarkUsedAsync(Guid id, DateTimeOffset at, CancellationToken cancellationToken);

    /// <summary>
    /// Every token of the instance for the administration, newest first, with its owner: <paramref name="query"/> keeps those whose
    /// name, prefix or owner's name contains it (ignoring case). Revoked ones are listed, with the date.
    /// </summary>
    Task<PagedResult<AdminAccessTokenDto>> ListAllAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken);
}
