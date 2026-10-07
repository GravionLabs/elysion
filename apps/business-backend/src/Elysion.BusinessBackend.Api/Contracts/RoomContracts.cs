using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A room as the caller sees it: the entity itself is never exposed. <c>Role</c> is the caller's role in it.</summary>
public sealed record RoomDto(Guid Id, string Name, DateTimeOffset CreatedAt, string Role)
{
    public static RoomDto From(Room room, BoardRole role) => new(room.Id, room.Name, room.CreatedAt, role.ToString());
}

/// <summary>Body for creating and for renaming a room. The name is checked and trimmed by the endpoint.</summary>
public sealed record RoomNameRequest(string? Name);

/// <summary>Body for moving a board: the room to put it in, or <c>null</c> to take it out of its room.</summary>
public sealed record MoveBoardRequest(Guid? RoomId);
