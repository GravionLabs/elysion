using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A board as the API returns it. The entity itself is never exposed.</summary>
public sealed record BoardDto(Guid Id, string Name, DateTimeOffset CreatedAt)
{
    public static BoardDto From(Board board) => new(board.Id, board.Name, board.CreatedAt);
}

/// <summary>Body for creating and for renaming a board. The name is checked and trimmed by the controller.</summary>
public sealed record BoardNameRequest(string? Name);
