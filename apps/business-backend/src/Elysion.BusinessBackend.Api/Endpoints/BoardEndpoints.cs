using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

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

    private static async Task<Ok<IReadOnlyList<BoardDto>>> List(ElysionDbContext db, CancellationToken cancellationToken)
    {
        var boards = await db.Boards
            .AsNoTracking()
            .OrderByDescending(board => board.CreatedAt)
            .ToListAsync(cancellationToken);
        return TypedResults.Ok<IReadOnlyList<BoardDto>>(boards.Select(BoardDto.From).ToList());
    }

    private static async Task<Results<Ok<BoardDto>, NotFound>> Get(Guid id, ElysionDbContext db, CancellationToken cancellationToken)
    {
        var board = await db.Boards.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        return board is null ? TypedResults.NotFound() : TypedResults.Ok(BoardDto.From(board));
    }

    private static async Task<Results<Created<BoardDto>, ValidationProblem>> Create(
        BoardNameRequest? request, HttpRequest http, ElysionDbContext db, TimeProvider time, CancellationToken cancellationToken)
    {
        if (!Board.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var board = Board.Create(Guid.CreateVersion7(), name, TruncateToMicroseconds(time.GetUtcNow()));
        db.Boards.Add(board);
        await db.SaveChangesAsync(cancellationToken);
        // An absolute Location, as CreatedAtAction produced.
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/boards/{board.Id}");
        return TypedResults.Created(location, BoardDto.From(board));
    }

    private static async Task<Results<Ok<BoardDto>, NotFound, ValidationProblem>> Rename(
        Guid id, BoardNameRequest? request, ElysionDbContext db, CancellationToken cancellationToken)
    {
        if (!Board.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (board is null)
        {
            return TypedResults.NotFound();
        }

        board.Name = name;
        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(BoardDto.From(board));
    }

    /// <summary>
    /// A new board named "&lt;name&gt; (copy)" with a copy of the source's stored content (ADR 0011). The copy
    /// is what was last saved: changes still inside a room's save window are not in it yet.
    /// </summary>
    private static async Task<Results<Created<BoardDto>, NotFound>> Duplicate(
        Guid id, HttpRequest http, ElysionDbContext db, TimeProvider time, CancellationToken cancellationToken)
    {
        var source = await db.Boards.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (source is null)
        {
            return TypedResults.NotFound();
        }

        var now = TruncateToMicroseconds(time.GetUtcNow());
        var copy = Board.Create(Guid.CreateVersion7(), CopyName(source.Name), now);
        db.Boards.Add(copy);

        var document = await db.BoardDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.BoardId == id.ToString(), cancellationToken);
        if (document is not null)
        {
            db.BoardDocuments.Add(new BoardDocument
            {
                BoardId = copy.Id.ToString(),
                State = (byte[])document.State.Clone(),
                Version = 1,
                UpdatedAt = now,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
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

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, ElysionDbContext db, CancellationToken cancellationToken)
    {
        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (board is null)
        {
            return TypedResults.NotFound();
        }

        db.Boards.Remove(board);
        // The canvas content goes with the board (ADR 0011).
        var document = await db.BoardDocuments.FirstOrDefaultAsync(d => d.BoardId == id.ToString(), cancellationToken);
        if (document is not null)
        {
            db.BoardDocuments.Remove(document);
        }

        await db.SaveChangesAsync(cancellationToken);
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
