using System.Net.Mime;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Stores the Yjs state of a board for the realtime service (ADR 0011). Internal only: the edge does not
/// route <c>/internal</c>. A save has to name the version it is based on (<c>If-Match</c>, or
/// <c>If-None-Match: *</c> for the first save); when the stored version moved on meanwhile the answer is
/// <c>409</c> with the stored state, so the caller can merge it and save again.
/// </summary>
public static class BoardDocumentEndpoints
{
    /// <summary>Largest state accepted; the measured large board (3,500 elements) is 2.3 MB.</summary>
    public const int MaxStateBytes = 32 * 1024 * 1024;

    private const string OctetStream = MediaTypeNames.Application.Octet;

    public static IEndpointRouteBuilder MapBoardDocumentEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/internal/boards/{boardId}/document").WithTags("Board documents");

        group.MapGet("", Get).WithName("GetBoardDocument");
        group.MapPut("", Put)
            .WithName("PutBoardDocument")
            .Accepts<byte[]>(OctetStream)
            .WithMetadata(new RequestSizeLimitAttribute(MaxStateBytes));
        group.MapDelete("", Delete).WithName("DeleteBoardDocument");
        return routes;
    }

    private static async Task<IResult> Get(string boardId, ElysionDbContext db, CancellationToken cancellationToken)
    {
        if (!IsValidId(boardId)) return TypedResults.BadRequest();
        var document = await db.BoardDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
        return document is null ? TypedResults.NotFound() : new StateResult(document, StatusCodes.Status200OK);
    }

    private static async Task<IResult> Put(
        string boardId, HttpRequest request, ElysionDbContext db, TimeProvider time, CancellationToken cancellationToken)
    {
        if (!IsValidId(boardId)) return TypedResults.BadRequest();
        if (request.ContentType?.StartsWith(OctetStream, StringComparison.OrdinalIgnoreCase) != true)
        {
            return TypedResults.StatusCode(StatusCodes.Status415UnsupportedMediaType);
        }

        var ifMatch = request.Headers.IfMatch.ToString();
        var create = request.Headers.IfNoneMatch.ToString() == "*";
        if (!create && !TryParseVersion(ifMatch, out _))
        {
            return TypedResults.Problem(
                "Send If-Match with the version the state is based on, or If-None-Match: * for the first save.",
                statusCode: StatusCodes.Status428PreconditionRequired);
        }

        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, cancellationToken);
        var state = buffer.ToArray();

        var document = await db.BoardDocuments.FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
        if (create)
        {
            if (document is not null) return new StateResult(document, StatusCodes.Status409Conflict);
            document = new BoardDocument { BoardId = boardId, State = state, Version = 1, UpdatedAt = time.GetUtcNow() };
            db.BoardDocuments.Add(document);
        }
        else
        {
            TryParseVersion(ifMatch, out var expected);
            if (document is null) return TypedResults.NotFound();
            if (document.Version != expected) return new StateResult(document, StatusCodes.Status409Conflict);

            document.State = state;
            document.Version = expected + 1;
            document.UpdatedAt = time.GetUtcNow();
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is DbUpdateConcurrencyException or DbUpdateException)
        {
            // Another request saved between our read and our write: hand back what is stored now.
            db.ChangeTracker.Clear();
            var current = await db.BoardDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
            return current is null
                ? TypedResults.StatusCode(StatusCodes.Status409Conflict)
                : new StateResult(current, StatusCodes.Status409Conflict);
        }

        return new SavedResult(document.Version);
    }

    private static async Task<IResult> Delete(string boardId, ElysionDbContext db, CancellationToken cancellationToken)
    {
        if (!IsValidId(boardId)) return TypedResults.BadRequest();
        var document = await db.BoardDocuments.FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
        if (document is not null)
        {
            db.BoardDocuments.Remove(document);
            await db.SaveChangesAsync(cancellationToken);
        }

        return TypedResults.NoContent();
    }

    private static bool IsValidId(string boardId) => boardId.Length is >= 1 and <= BoardDocument.MaxBoardIdLength;

    private static string ETag(long version) => $"\"{version}\"";

    private static bool TryParseVersion(string header, out long version) =>
        long.TryParse(header.Trim().Trim('"'), out version) && version > 0;

    /// <summary>The state as the body with the version as its ETag, under a status of the caller's choice.</summary>
    private sealed class StateResult(BoardDocument document, int statusCode) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var response = httpContext.Response;
            response.StatusCode = statusCode;
            response.Headers.ETag = ETag(document.Version);
            response.ContentType = OctetStream;
            response.ContentLength = document.State.Length;
            await response.Body.WriteAsync(document.State, httpContext.RequestAborted);
        }
    }

    /// <summary>204 carrying the new version as the ETag.</summary>
    private sealed class SavedResult(long version) : IResult
    {
        public Task ExecuteAsync(HttpContext httpContext)
        {
            httpContext.Response.StatusCode = StatusCodes.Status204NoContent;
            httpContext.Response.Headers.ETag = ETag(version);
            return Task.CompletedTask;
        }
    }
}
