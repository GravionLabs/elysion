using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A board as the API returns it. The entity itself is never exposed.</summary>
public sealed record BoardDto(
    Guid Id,
    string Name,
    DateTimeOffset CreatedAt,
    Guid? RoomId,
    DateTimeOffset? ThumbnailUpdatedAt = null,
    DateTimeOffset? LastOpenedAt = null,
    bool IsFavorite = false)
{
    /// <summary>Whether the board has a preview picture (<c>GET /boards/{id}/thumbnail</c>).</summary>
    public bool HasThumbnail => ThumbnailUpdatedAt is not null;

    public static BoardDto From(Board board) =>
        new(board.Id, board.Name, board.CreatedAt, board.RoomId, board.ThumbnailUpdatedAt);

    /// <summary>The board as one person sees it: with when they last opened it (<c>LastOpenedAt</c>) and their star (<c>IsFavorite</c>).</summary>
    public static BoardDto From(Board board, BoardUserState state) =>
        From(board) with { LastOpenedAt = state.LastOpenedAt, IsFavorite = state.IsFavorite };
}

/// <summary>Body for creating and for renaming a board. The name is checked and trimmed by the endpoint.</summary>
public sealed record BoardNameRequest(string? Name);
