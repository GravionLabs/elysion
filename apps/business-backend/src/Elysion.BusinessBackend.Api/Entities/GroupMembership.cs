using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>A person in a group. The pair (<see cref="GroupId"/>, <see cref="UserId"/>) is the key.</summary>
public class GroupMembership
{
    public Guid GroupId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Group? Group { get; set; }
    public User? User { get; set; }

    public static GroupMembership Create(Guid groupId, Guid userId, DateTimeOffset createdAt)
    {
        Guard.Against.Default(groupId);
        Guard.Against.Default(userId);
        return new GroupMembership { GroupId = groupId, UserId = userId, CreatedAt = createdAt };
    }
}
