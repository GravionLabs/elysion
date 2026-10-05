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
}
