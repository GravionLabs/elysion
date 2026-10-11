using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Files;

using Microsoft.Net.Http.Headers;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// The preview picture of a board, the image on its card (#729): a PNG the shell renders when an editor leaves the board, kept in
/// the object store under <see cref="FileTypes.ThumbnailKey"/> (one per board, replaced by the next). Writing needs the board's
/// write role, reading its read role. The board's <c>ThumbnailUpdatedAt</c> is the version of the picture: the list carries it and
/// the card puts it in the address, so a new picture is fetched and an unchanged one comes from the browser's cache.
/// </summary>
public static class BoardThumbnailEndpoints
{
    /// <summary>The largest picture accepted: a 480 by 300 PNG is far below it.</summary>
    public const int MaxThumbnailBytes = 512 * 1024;

    public static IEndpointRouteBuilder MapBoardThumbnailEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards/{id:guid}/thumbnail").WithTags("Board thumbnails");

        group.MapPut("", Put)
            .WithName("PutBoardThumbnail")
            .Accepts<byte[]>(FileTypes.Png)
            .RequireAuthorization(BoardPolicies.Write);
        group.MapGet("", Get).WithName("GetBoardThumbnail").RequireAuthorization(BoardPolicies.Read);
        return routes;
    }

    private static async Task<IResult> Put(
        Guid id,
        HttpRequest request,
        IBoardRepository boards,
        IUnitOfWork unitOfWork,
        IFileStore store,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var declared = MediaTypeHeaderValue.TryParse(request.ContentType, out var parsed)
            ? parsed.MediaType.Value
            : null;
        if (declared != FileTypes.Png)
        {
            return TypedResults.StatusCode(StatusCodes.Status415UnsupportedMediaType);
        }

        if (request.ContentLength > MaxThumbnailBytes)
        {
            return TooLarge();
        }

        using var buffer = new MemoryStream();
        var read = await request.Body.CopyToLimitAsync(buffer, MaxThumbnailBytes + 1, cancellationToken);
        if (read > MaxThumbnailBytes)
        {
            return TooLarge();
        }

        if (buffer.Length == 0 || FileTypes.Sniff(buffer.GetBuffer().AsSpan(0, (int)buffer.Length)) != FileTypes.Png)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["content"] = ["The content is not a PNG image."],
            });
        }

        var board = await boards.FindForUpdateAsync(id, cancellationToken);
        if (board is null)
        {
            return TypedResults.NotFound();
        }

        buffer.Position = 0;
        await store.PutAsync(FileTypes.ThumbnailKey(id), buffer, FileTypes.Png, cancellationToken);
        var now = time.GetUtcNow();
        // What Postgres keeps, so that the value in the list is the one the next read gives back.
        board.ThumbnailUpdatedAt = new DateTimeOffset(now.Ticks - now.Ticks % 10, now.Offset);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Get(
        Guid id,
        HttpRequest request,
        IBoardRepository boards,
        IFileStore store,
        CancellationToken cancellationToken)
    {
        var board = await boards.FindAsync(id, cancellationToken);
        if (board?.ThumbnailUpdatedAt is not { } updated)
        {
            return TypedResults.NotFound();
        }

        // The version of the picture is its timestamp: an unchanged one is answered 304 without reading the store.
        var etag = $"\"{updated.UtcTicks:x}\"";
        if (request.Headers.IfNoneMatch.Any(value => value is not null && value.Split(',').Any(v => v.Trim() == etag)))
        {
            return TypedResults.StatusCode(StatusCodes.Status304NotModified);
        }

        var file = await store.GetAsync(FileTypes.ThumbnailKey(id), cancellationToken);
        return file is null ? TypedResults.NotFound() : new ThumbnailResult(file, etag);
    }

    private static Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult TooLarge() =>
        TypedResults.Problem($"A thumbnail is at most {MaxThumbnailBytes} bytes.",
            statusCode: StatusCodes.Status413PayloadTooLarge);

    /// <summary>
    /// The picture as the body, with its version as the ETag. <c>private</c> (who may see it depends on the caller) and
    /// <c>no-cache</c>: the browser keeps it but asks first, and the card's <c>?v=</c> makes a changed picture a new address anyway.
    /// </summary>
    private sealed class ThumbnailResult(StoredFile file, string etag) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            await using var _ = file;
            var response = httpContext.Response;
            response.ContentType = FileTypes.Png;
            response.ContentLength = file.Length;
            response.Headers.CacheControl = "private, no-cache";
            response.Headers["X-Content-Type-Options"] = "nosniff";
            response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
            response.Headers.ETag = etag;
            await file.Content.CopyToAsync(response.Body, httpContext.RequestAborted);
        }
    }
}
