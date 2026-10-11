using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>A person in a group. The pair (<see cref="GroupId"/>, <see cref="UserId"/>) is the key.</summary>
public class GroupMembership
{
    public Guid GroupId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// Whether the membership was made by the Graph sync (#667) and not by a token or an administrator. Only such a membership is
    /// taken away by the sync when the directory no longer lists the person; a token that lists the group makes it the token's.
    /// </summary>
    public bool FromGraph { get; set; }

    public Group? Group { get; set; }
    public User? User { get; set; }

    public static GroupMembership Create(Guid groupId, Guid userId, DateTimeOffset createdAt)
    {
        Guard.Against.Default(groupId);
        Guard.Against.Default(userId);
        return new GroupMembership { GroupId = groupId, UserId = userId, CreatedAt = createdAt };
    }
}
