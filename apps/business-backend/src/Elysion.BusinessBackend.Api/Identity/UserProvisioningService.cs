using System.Security.Claims;
using Ardalis.GuardClauses;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

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
public sealed class UserProvisioningService(IUserRepository users, IUnitOfWork unitOfWork, TimeProvider time)
{
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
            if (ReferenceEquals(user, created))
            {
                return user;
            }
        }

        if (user.Email != email || user.DisplayName != displayName)
        {
            user.Email = email;
            user.DisplayName = displayName;
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return user;
    }

    private static string? Claim(ClaimsPrincipal principal, string type)
    {
        var value = principal.FindFirst(type)?.Value;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
