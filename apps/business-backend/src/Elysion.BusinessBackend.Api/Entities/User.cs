using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A person known to Elysion. The row is created the first time a Keycloak token for the person is seen
/// (just-in-time, #115); the identity provider stays the source of truth for who they are.
/// </summary>
public class User
{
    public const int MaxSubjectLength = 255;
    public const int MaxEmailLength = 320;
    public const int MaxDisplayNameLength = 200;

    /// <summary>The local key, which other tables point at.</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// The token's <c>sub</c> claim: the join to the identity provider. Unique. Not the email, which a
    /// person can change and an identity provider can reuse.
    /// </summary>
    public required string Subject { get; set; }

    /// <summary>The email as of the last sign-in; absent when the provider has none for the person.</summary>
    public string? Email { get; set; }

    public required string DisplayName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<BoardMembership> Memberships { get; set; } = [];

    /// <summary>A user with a subject, a display name and (optionally) an email that fit the model.</summary>
    public static User Create(Guid id, string subject, string displayName, string? email, DateTimeOffset createdAt)
    {
        Guard.Against.Default(id);
        Guard.Against.NullOrWhiteSpace(subject);
        Guard.Against.InvalidInput(subject, nameof(subject), s => s.Length <= MaxSubjectLength);
        Guard.Against.NullOrWhiteSpace(displayName);
        Guard.Against.InvalidInput(displayName, nameof(displayName), n => n.Trim().Length <= MaxDisplayNameLength);
        if (email is not null)
        {
            Guard.Against.InvalidInput(email, nameof(email), e => e.Length <= MaxEmailLength);
        }

        return new User
        {
            Id = id,
            Subject = subject,
            DisplayName = displayName.Trim(),
            Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim(),
            CreatedAt = createdAt,
        };
    }
}
