using System.Security.Claims;

using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Turns the authenticated principal into a local <see cref="User"/> (just-in-time: the first request of a
/// person creates the row) and keeps its email and display name in step with the token.
/// </summary>
/// <remarks>
/// Claim mapping, in one place (Keycloak's access token):
/// <list type="bullet">
/// <item><c>sub</c> → <see cref="User.Subject"/>. Required: a token without it is not a person we can name.</item>
/// <item><c>email</c> → <see cref="User.Email"/>. Optional.</item>
/// <item><c>preferred_username</c>, else <c>name</c>, else <c>email</c>, else <c>sub</c> → <see cref="User.DisplayName"/>:
/// a display name is never blank, whichever optional claims the realm leaves out.</item>
/// </list>
/// </remarks>
public sealed class UserProvisioningService(
    IUserRepository users,
    IGroupRepository groups,
    IUnitOfWork unitOfWork,
    IMemoryCache cache,
    IOptions<OidcOptions> oidc,
    TimeProvider time)
{
    /// <summary>The most groups one token may put a person into; more are ignored (a token that long is a misconfiguration).</summary>
    public const int MaxGroupsPerToken = 500;

    /// <summary>How long a person's last claim is remembered; the sync reads the database again after it.</summary>
    private static readonly TimeSpan GroupClaimMemory = TimeSpan.FromHours(1);

    public const string SubjectClaim = "sub";
    public const string EmailClaim = "email";
    public const string PreferredUsernameClaim = "preferred_username";
    public const string NameClaim = "name";

    /// <summary>The local user of the principal, or null when it has no <c>sub</c> claim.</summary>
    public async Task<User?> ProvisionAsync(ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        Guard.Against.Null(principal);
        var subject = Claim(principal, SubjectClaim);
        if (subject is null)
        {
            return null;
        }

        var email = Claim(principal, EmailClaim);
        var displayName = Claim(principal, PreferredUsernameClaim) ?? Claim(principal, NameClaim) ?? email ?? subject;
        displayName = Truncate(displayName, User.MaxDisplayNameLength);
        email = email is null ? null : Truncate(email, User.MaxEmailLength);

        var user = await users.FindBySubjectForUpdateAsync(subject, cancellationToken);
        if (user is null)
        {
            // A token can carry a longer subject than the model keeps; refuse it rather than store a cut one.
            if (subject.Length > User.MaxSubjectLength)
            {
                return null;
            }

            var created = User.Create(Guid.CreateVersion7(), subject, displayName, email, time.GetUtcNow());
            // Another request may have created the same person since the lookup: the repository returns its row.
            user = await users.GetOrAddAsync(created, cancellationToken);
            if (!ReferenceEquals(user, created))
            {
                await UpdateAsync(user, email, displayName, cancellationToken);
            }
        }
        else
        {
            await UpdateAsync(user, email, displayName, cancellationToken);
        }

        await SyncGroupsAsync(user, principal, cancellationToken);
        return user;
    }

    private async Task UpdateAsync(User user, string? email, string displayName, CancellationToken cancellationToken)
    {
        if (user.Email != email || user.DisplayName != displayName)
        {
            user.Email = email;
            user.DisplayName = displayName;
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
    }

    /// <summary>
    /// Makes the person's memberships in linked groups the claim's values (ADR 0027): groups that do not exist yet are created, the
    /// ones left out of the claim are dropped, local groups are not touched. A claim that is the one seen last (a hash of the sorted
    /// values, remembered per person for an hour) costs no database call; memberships are therefore as fresh as the token, and a
    /// change made in the database by hand is noticed after the hour at the latest.
    /// </summary>
    private async Task SyncGroupsAsync(User user, ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        var claimName = oidc.Value.GroupsClaim;
        if (string.IsNullOrWhiteSpace(claimName))
        {
            return;
        }

        // A value that is not a usable id (empty, over 255 characters) is left out rather than cut: a cut id would be another group's.
        var values = principal.FindAll(claimName)
            .Select(c => c.Value.Trim())
            .Where(v => v.Length is >= 1 and <= Group.MaxExternalIdLength)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .Take(MaxGroupsPerToken)
            .ToList();
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(string.Join('\n', values))));
        var key = (typeof(UserProvisioningService), user.Id);
        if (cache.TryGetValue(key, out string? seen) && seen == hash)
        {
            return;
        }

        await groups.SetLinkedMembershipsAsync(user.Id, values, time.GetUtcNow(), cancellationToken);
        cache.Set(key, hash, GroupClaimMemory);
    }

    private static string? Claim(ClaimsPrincipal principal, string type)
    {
        var value = principal.FindFirst(type)?.Value;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
