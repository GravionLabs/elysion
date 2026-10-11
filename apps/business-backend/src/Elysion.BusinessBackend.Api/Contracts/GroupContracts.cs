using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A group as the API returns it: no members, and the source says whether the provider owns them.</summary>
public sealed record GroupDto(Guid Id, string Name, string Source)
{
    public static GroupDto From(Group group) => new(group.Id, group.Name, group.Source.ToString());
}

/// <summary>A group's role in a room (<c>Role</c> is Owner, Editor or Viewer).</summary>
public sealed record RoomGroupDto(Guid GroupId, string Name, string Role);

/// <summary>Body of <c>PUT /rooms/{id}/groups/{groupId}</c>.</summary>
public sealed record RoomGroupRoleRequest(string? Role);
