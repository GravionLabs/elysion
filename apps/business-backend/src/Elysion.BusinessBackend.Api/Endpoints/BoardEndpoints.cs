using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Board CRUD. There is no owner or authorization yet (users and policies come with the identity
/// epic), so every caller sees every board. Reached through the BFF only.
/// </summary>
public static class BoardEndpoints
{
    public const int MaxNameLength = Board.MaxNameLength;

    public static IEndpointRouteBuilder MapBoardEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards").WithTags("Boards");

        group.MapGet("", List).WithName("ListBoards");
        group.MapGet("/{id:guid}", Get).WithName("GetBoard");
        group.MapPost("", Create).WithName("CreateBoard").Accepts<BoardNameRequest>("application/json").RequireJsonContentType();
        group.MapPatch("/{id:guid}", Rename).WithName("RenameBoard").Accepts<BoardNameRequest>("application/json").RequireJsonContentType();
        group.MapPost("/{id:guid}/duplicate", Duplicate).WithName("DuplicateBoard");
        group.MapDelete("/{id:guid}", Delete).WithName("DeleteBoard");
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<BoardDto>>> List(IBoardRepository boards, CancellationToken cancellationToken)
    {
        var all = await boards.ListNewestFirstAsync(cancellationToken);
        return TypedResults.Ok<IReadOnlyList<BoardDto>>(all.Select(BoardDto.From).ToList());
    }

    private static async Task<Results<Ok<BoardDto>, NotFound>> Get(Guid id, IBoardRepository boards, CancellationToken cancellationToken)
    {
        var board = await boards.FindAsync(id, cancellationToken);
        return board is null ? TypedResults.NotFound() : TypedResults.Ok(BoardDto.From(board));
    }

    private static async Task<Results<Created<BoardDto>, ValidationProblem>> Create(
        BoardNameRequest? request, HttpRequest http, IBoardRepository boards, IUnitOfWork unitOfWork, TimeProvider time, CancellationToken cancellationToken)
    {
        if (!Board.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var board = Board.Create(Guid.CreateVersion7(), name, TruncateToMicroseconds(time.GetUtcNow()));
        boards.Add(board);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        // An absolute Location, as CreatedAtAction produced.
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/boards/{board.Id}");
        return TypedResults.Created(location, BoardDto.From(board));
    }

    private static async Task<Results<Ok<BoardDto>, NotFound, ValidationProblem>> Rename(
        Guid id, BoardNameRequest? request, IBoardRepository boards, IUnitOfWork unitOfWork, CancellationToken cancellationToken)
    {
        if (!Board.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var board = await boards.FindForUpdateAsync(id, cancellationToken);
        if (board is null)
        {
            return TypedResults.NotFound();
        }

        board.Name = name;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(BoardDto.From(board));
    }

    /// <summary>
    /// A new board named "&lt;name&gt; (copy)" with a copy of the source's stored content (ADR 0011). The copy
    /// is what was last saved: changes still inside a room's save window are not in it yet.
    /// </summary>
    private static async Task<Results<Created<BoardDto>, NotFound>> Duplicate(
        Guid id, HttpRequest http, IBoardRepository boards, IBoardDocumentRepository documents, IUnitOfWork unitOfWork,
        TimeProvider time, CancellationToken cancellationToken)
    {
        var source = await boards.FindAsync(id, cancellationToken);
        if (source is null)
        {
            return TypedResults.NotFound();
        }

        var now = TruncateToMicroseconds(time.GetUtcNow());
        var copy = Board.Create(Guid.CreateVersion7(), CopyName(source.Name), now);
        boards.Add(copy);

        var document = await documents.FindAsync(id.ToString(), cancellationToken);
        if (document is not null)
        {
            documents.Add(new BoardDocument
            {
                BoardId = copy.Id.ToString(),
                State = (byte[])document.State.Clone(),
                Version = 1,
                UpdatedAt = now,
            });
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/boards/{copy.Id}");
        return TypedResults.Created(location, BoardDto.From(copy));
    }

    /// <summary>"&lt;name&gt; (copy)", with the name cut short when the suffix would not fit the limit.</summary>
    internal static string CopyName(string name)
    {
        const string suffix = " (copy)";
        return name.Length + suffix.Length <= MaxNameLength
            ? name + suffix
            : name[..(MaxNameLength - suffix.Length)].TrimEnd() + suffix;
    }

    private static async Task<Results<NoContent, NotFound>> Delete(
        Guid id, IBoardRepository boards, IBoardDocumentRepository documents, IUnitOfWork unitOfWork, CancellationToken cancellationToken)
    {
        var board = await boards.FindForUpdateAsync(id, cancellationToken);
        if (board is null)
        {
            return TypedResults.NotFound();
        }

        boards.Remove(board);
        // The canvas content goes with the board (ADR 0011).
        await documents.RemoveAsync(id.ToString(), cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    // Postgres keeps microseconds; without this the response to the create would show more digits than
    // every later read of the same board.
    private static DateTimeOffset TruncateToMicroseconds(DateTimeOffset value) =>
        new(value.Ticks - value.Ticks % 10, value.Offset);

    private static ValidationProblem InvalidName() =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = [$"The name must be between 1 and {MaxNameLength} characters."],
        });
}
