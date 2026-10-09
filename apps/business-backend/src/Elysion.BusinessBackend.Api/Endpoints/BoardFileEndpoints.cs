using System.Net.Mime;

using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Files;

using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// The files (images) of a board, kept in the object store and not in the shared document (#702). The id is the one
/// Excalidraw gives a file, a hash of its content, so the same image is stored once per board. Writing needs the
/// board's write role, reading its read role (a missing role is a 404 as everywhere, <see cref="BoardAuthorizationResultHandler"/>).
/// </summary>
public static class BoardFileEndpoints
{
    public static IEndpointRouteBuilder MapBoardFileEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards/{id:guid}/files/{fileId}").WithTags("Board files");

        group.MapPut("", Put)
            .WithName("PutBoardFile")
            .Accepts<byte[]>(FileTypes.Png, FileTypes.Jpeg, FileTypes.Gif, FileTypes.WebP)
            .RequireAuthorization(BoardPolicies.Write);
        group.MapGet("", Get).WithName("GetBoardFile").RequireAuthorization(BoardPolicies.Read);
        return routes;
    }

    private static async Task<IResult> Put(
        Guid id,
        string fileId,
        HttpRequest request,
        IFileStore store,
        IOptions<Files.FileOptions> options,
        CancellationToken cancellationToken)
    {
        var limits = options.Value;
        if (!FileTypes.IsValidFileId(fileId))
        {
            return Invalid("fileId", "The file id must be 8 to 64 letters, digits, '-' or '_'.");
        }

        var declared = MediaTypeHeaderValue.TryParse(request.ContentType, out var parsed)
            ? parsed.MediaType.Value
            : null;
        if (!FileTypes.IsAllowed(declared))
        {
            return TypedResults.StatusCode(StatusCodes.Status415UnsupportedMediaType);
        }

        if (request.ContentLength > limits.MaxFileBytes)
        {
            return TooLarge(limits.MaxFileBytes);
        }

        // Up to the limit and one byte more, to tell a file that fits from one that does not whatever the headers said.
        using var buffer = new MemoryStream();
        var read = await request.Body.CopyToLimitAsync(buffer, limits.MaxFileBytes + 1, cancellationToken);
        if (read > limits.MaxFileBytes)
        {
            return TooLarge(limits.MaxFileBytes);
        }

        if (buffer.Length == 0 || FileTypes.Sniff(buffer.GetBuffer().AsSpan(0, (int)buffer.Length)) != declared)
        {
            return Invalid("content", $"The content is not a {declared} image.");
        }

        var key = FileTypes.Prefix(id) + fileId;
        // The same image again (same hash) replaces itself and does not count twice.
        if (!await store.ExistsAsync(key, cancellationToken)
            && await store.CountAsync(FileTypes.Prefix(id), cancellationToken) >= limits.MaxFilesPerBoard)
        {
            return TypedResults.Problem(
                $"A board holds at most {limits.MaxFilesPerBoard} files.",
                statusCode: StatusCodes.Status409Conflict);
        }

        buffer.Position = 0;
        await store.PutAsync(key, buffer, declared!, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Get(
        Guid id,
        string fileId,
        IFileStore store,
        CancellationToken cancellationToken)
    {
        if (!FileTypes.IsValidFileId(fileId))
        {
            return TypedResults.NotFound();
        }

        var file = await store.GetAsync(FileTypes.Prefix(id) + fileId, cancellationToken);
        return file is null ? TypedResults.NotFound() : new FileResult(file);
    }

    private static Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult TooLarge(long limit) =>
        TypedResults.Problem($"A file is at most {limit} bytes.", statusCode: StatusCodes.Status413PayloadTooLarge);

    private static Microsoft.AspNetCore.Http.HttpResults.ValidationProblem Invalid(string field, string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>
    /// The object as the body. The id is a hash of the content, so a file never changes: browsers keep it for a year, but
    /// <c>private</c> because who may read it depends on the caller. <c>nosniff</c> and a sandboxing CSP keep a
    /// type confusion harmless even if one ever got past the checks at upload.
    /// </summary>
    private sealed class FileResult(StoredFile file) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            await using var _ = file;
            var response = httpContext.Response;
            response.ContentType = file.ContentType;
            response.ContentLength = file.Length;
            response.Headers.CacheControl = "private, max-age=31536000, immutable";
            response.Headers["X-Content-Type-Options"] = "nosniff";
            response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
            if (file.ETag is not null)
            {
                response.Headers.ETag = file.ETag;
            }

            await file.Content.CopyToAsync(response.Body, httpContext.RequestAborted);
        }
    }
}

internal static class StreamLimitExtensions
{
    /// <summary>Copies at most <paramref name="limit"/> bytes and returns how many were copied.</summary>
    public static async Task<long> CopyToLimitAsync(this Stream source,
        Stream target,
        long limit,
        CancellationToken cancellationToken)
    {
        var chunk = new byte[81920];
        long total = 0;
        while (total < limit)
        {
            var read = await source.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, limit - total)),
                cancellationToken);
            if (read == 0)
            {
                break;
            }

            await target.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
            total += read;
        }

        return total;
    }
}
