using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A person the directory lists in a linked group (Microsoft Graph, #667) who has no <see cref="User"/> row yet. It turns into a real
/// <see cref="GroupMembership"/> when the person signs in for the first time and their email matches. The email is kept in lower case.
/// </summary>
public class PendingGroupMembership
{
    public const int MaxObjectIdLength = 64;

    public Guid Id { get; set; }
    public Guid GroupId { get; set; }

    /// <summary>The address the directory has for the person (lower case); how the person is recognised at their first sign-in.</summary>
    public required string Email { get; set; }

    /// <summary>The name the directory gives the person, for the administrator's list; may be missing.</summary>
    public string? DisplayName { get; set; }

    /// <summary>The directory's object id of the person, for the administrator; not used to match.</summary>
    public string? ObjectId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Group? Group { get; set; }

    public static PendingGroupMembership Create(Guid groupId,
        string email,
        string? displayName,
        string? objectId,
        DateTimeOffset createdAt)
    {
        Guard.Against.Default(groupId);
        Guard.Against.NullOrWhiteSpace(email);
        var normalized = email.Trim().ToLowerInvariant();
        Guard.Against.InvalidInput(normalized, nameof(email), e => e.Length <= User.MaxEmailLength);
        return new PendingGroupMembership
        {
            Id = Guid.CreateVersion7(),
            GroupId = groupId,
            Email = normalized,
            DisplayName = Cut(displayName, User.MaxDisplayNameLength),
            ObjectId = Cut(objectId, MaxObjectIdLength),
            CreatedAt = createdAt,
        };
    }

    private static string? Cut(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is { } v && v.Length > max ? v[..max] : value.Trim();
}
