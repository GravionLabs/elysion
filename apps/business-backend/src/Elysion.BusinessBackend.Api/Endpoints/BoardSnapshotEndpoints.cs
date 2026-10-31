using Amazon.Runtime;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Files;
using Elysion.BusinessBackend.Api.Quotas;
using Elysion.BusinessBackend.Api.Snapshots;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// The versions of a board (ADR 0032, #846). Viewers list and read, editors save and rename, owners delete. The bytes of a
/// snapshot come from the stored board document, never from the client. Restoring one is #847.
/// </summary>
public static class BoardSnapshotEndpoints
{
    public static IEndpointRouteBuilder MapBoardSnapshotEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards/{id:guid}/snapshots").WithTags("Board snapshots");

        group.MapGet("", List).WithName("ListBoardSnapshots").RequireAuthorization(BoardPolicies.Read);
        group.MapPost("", Create)
            .WithName("CreateBoardSnapshot")
            .Accepts<CreateSnapshotRequest>("application/json")
            .RequireAuthorization(BoardPolicies.Write);
        group.MapGet("/{snapshotId:guid}/document", ReadDocument)
            .WithName("GetBoardSnapshotDocument")
            .RequireAuthorization(BoardPolicies.Read);
        group.MapPatch("/{snapshotId:guid}", Rename)
            .WithName("RenameBoardSnapshot")
            .Accepts<RenameSnapshotRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(BoardPolicies.Write);
        group.MapPost("/{snapshotId:guid}/restore", Restore)
            .WithName("RestoreBoardSnapshot")
            .RequireAuthorization(BoardPolicies.Administer);
        group.MapPost("/{snapshotId:guid}/copy", OpenAsNewBoard)
            .WithName("OpenBoardSnapshotAsNewBoard")
            .RequireAuthorization(BoardPolicies.Read);
        group.MapDelete("/{snapshotId:guid}", Delete)
            .WithName("DeleteBoardSnapshot")
            .RequireAuthorization(BoardPolicies.Administer);

        // The realtime service reads the bytes of a version it restores from here (ADR 0032, #847): the service token only.
        routes.MapGet("/internal/boards/{boardId:guid}/snapshots/{snapshotId:guid}/document", ReadDocumentInternal)
            .WithTags("Board snapshots")
            .WithName("GetBoardSnapshotDocumentInternal")
            .RequireAuthorization(InternalApiOptions.Policy);
        return routes;
    }

    private static async Task<IResult> ReadDocumentInternal(
        Guid boardId,
        Guid snapshotId,
        IBoardSnapshotRepository snapshots,
        BoardSnapshotService service,
        CancellationToken cancellationToken) =>
        await ReadDocument(boardId, snapshotId, snapshots, service, cancellationToken);

    /// <summary>
    /// Restores a version onto the board (ADR 0032): keeps the current state as "Before restore" (which a later restore can go
    /// back to), then has the realtime service merge the version into the live board for everybody on it. Answers with the
    /// "Before restore" version it kept (null when the board had no stored state).
    /// </summary>
    private static async Task<IResult> Restore(
        Guid id,
        Guid snapshotId,
        IBoardSnapshotRepository snapshots,
        BoardSnapshotService service,
        IRealtimeBoardRestorer restorer,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var found = await snapshots.FindAsync(id, snapshotId, cancellationToken);
        if (found is null)
        {
            return TypedResults.NotFound();
        }

        BoardSnapshot? before;
        try
        {
            if (await service.ReadStateAsync(found.Value.Snapshot, cancellationToken) is null)
            {
                return MissingVersion();
            }

            bool saved;
            (saved, before) = await service.CreateBeforeRestoreAsync(id, cancellationToken);
            if (!saved)
            {
                // The live state could not be stored, so "Before restore" would lag it: restoring would lose edits for good.
                return TypedResults.Problem("The board could not be saved before the restore. Try again in a moment.",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        }
        catch (Exception e) when (e is AmazonServiceException or HttpRequestException)
        {
            return StoreUnavailable();
        }

        var status = await restorer.RestoreAsync(id,
            snapshotId,
            user.DisplayName,
            found.Value.Snapshot.CreatedAt,
            cancellationToken);
        switch (status)
        {
            case RealtimeRestoreStatus.SnapshotMissing:
                return MissingVersion();
            case RealtimeRestoreStatus.Unavailable:
                return TypedResults.Problem("The board could not be restored. Try again in a moment.",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        audit.Record(AuditActions.SnapshotRestored,
            AuditActions.Board,
            id,
            new { snapshotId, kind = found.Value.Snapshot.Kind.ToString() });
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(new RestoreSnapshotResponse(before is null ? null : ToDto(before, null)));
    }

    /// <summary>
    /// "Open as new board": a new board owned by the caller with the version's state, named "&lt;board&gt; (&lt;version name or time&gt;)",
    /// like a duplicate (the images are copied along; the versions of the source are not).
    /// </summary>
    private static async Task<IResult> OpenAsNewBoard(
        Guid id,
        Guid snapshotId,
        HttpRequest http,
        IBoardRepository boards,
        IBoardSnapshotRepository snapshots,
        BoardSnapshotService service,
        IOptions<QuotaOptions> quotas,
        IBoardDocumentRepository documents,
        IFileStore files,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var found = await snapshots.FindAsync(id, snapshotId, cancellationToken);
        var source = await boards.FindAsync(id, cancellationToken);
        if (found is null || source is null)
        {
            return TypedResults.NotFound();
        }

        if (await BoardEndpoints.OverBoardQuotaAsync(boards, quotas.Value, user, cancellationToken))
        {
            return BoardEndpoints.BoardQuotaReached(quotas.Value);
        }

        byte[]? state;
        try
        {
            state = await service.ReadStateAsync(found.Value.Snapshot, cancellationToken);
        }
        catch (Exception e) when (e is AmazonServiceException or HttpRequestException)
        {
            return StoreUnavailable();
        }

        if (state is null)
        {
            return MissingVersion();
        }

        var now = BoardEndpoints.TruncateToMicroseconds(time.GetUtcNow());
        var copy = BoardEndpoints.NewOwnedBoard(CopyName(source.Name, found.Value.Snapshot), user, now);
        boards.Add(copy);
        documents.Add(new BoardDocument
        {
            BoardId = copy.Id.ToString(), State = state, Version = 1, UpdatedAt = now,
        });
        await unitOfWork.SaveChangesAsync(cancellationToken);
        // The images the version's document refers to (the files of the source, under the same ids).
        await files.CopyPrefixAsync(FileTypes.Prefix(id), FileTypes.Prefix(copy.Id), cancellationToken);
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/boards/{copy.Id}");
        return TypedResults.Created(location, BoardDto.From(copy));
    }

    /// <summary>"&lt;board&gt; (&lt;version name or UTC time&gt;)", with the board's name cut short when it would not fit the limit.</summary>
    internal static string CopyName(string boardName, BoardSnapshot snapshot)
    {
        var label = snapshot.Name ?? snapshot.CreatedAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm 'UTC'",
            System.Globalization.CultureInfo.InvariantCulture);
        // A long version name is cut so that the board's name keeps room in the limit.
        if (label.Length > MaxLabelLength)
        {
            label = label[..MaxLabelLength].TrimEnd();
        }

        var suffix = $" ({label})";
        return boardName.Length + suffix.Length <= Board.MaxNameLength
            ? boardName + suffix
            : boardName[..(Board.MaxNameLength - suffix.Length)].TrimEnd() + suffix;
    }

    private const int MaxLabelLength = 60;

    private static ProblemHttpResult MissingVersion() =>
        TypedResults.Problem("The stored version is missing.", statusCode: StatusCodes.Status410Gone);

    private static ProblemHttpResult StoreUnavailable() =>
        TypedResults.Problem("The store for versions is not available.",
            statusCode: StatusCodes.Status503ServiceUnavailable);

    private static async Task<Ok<IReadOnlyList<SnapshotDto>>> List(
        Guid id,
        IBoardSnapshotRepository snapshots,
        CancellationToken cancellationToken)
    {
        var all = await snapshots.ListNewestFirstAsync(id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<SnapshotDto>>(all.Select(s => ToDto(s.Snapshot, s.Author)).ToList());
    }

    private static async Task<IResult> Create(
        Guid id,
        CreateSnapshotRequest? request,
        HttpRequest http,
        BoardSnapshotService service,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!BoardSnapshot.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        SnapshotCreateResult result;
        try
        {
            result = await service.CreateManualAsync(id, name, user.Subject, cancellationToken);
        }
        catch (Exception e) when (e is AmazonServiceException or HttpRequestException)
        {
            // History needs the object store (ADR 0032).
            return TypedResults.Problem("The store for versions is not available.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        switch (result)
        {
            case { Status: SnapshotCreateStatus.LimitReached }:
                return TypedResults.Problem(
                    $"A board keeps at most {BoardSnapshotService.MaxManualPerBoard} saved versions. Delete one to save another.",
                    statusCode: StatusCodes.Status409Conflict,
                    title: "Version limit reached");
            case { Status: SnapshotCreateStatus.NothingSaved }:
                return TypedResults.Problem("The board has nothing saved yet.",
                    statusCode: StatusCodes.Status409Conflict);
            default:
                var location = UriHelper.BuildAbsolute(http.Scheme,
                    http.Host,
                    http.PathBase,
                    $"/boards/{id}/snapshots/{result.Snapshot!.Value.Snapshot.Id}");
                return TypedResults.Created(location, ToDto(result.Snapshot.Value.Snapshot, user.DisplayName));
        }
    }

    /// <summary>The Yjs state of the snapshot, ungzipped, for the preview picture and for opening it as a new board.</summary>
    private static async Task<IResult> ReadDocument(
        Guid id,
        Guid snapshotId,
        IBoardSnapshotRepository snapshots,
        BoardSnapshotService service,
        CancellationToken cancellationToken)
    {
        var found = await snapshots.FindAsync(id, snapshotId, cancellationToken);
        if (found is null)
        {
            return TypedResults.NotFound();
        }

        var state = await service.ReadStateAsync(found.Value.Snapshot, cancellationToken);
        // A row without its object is reported as missing (ADR 0032).
        return state is null
            ? TypedResults.Problem("The stored version is missing.", statusCode: StatusCodes.Status410Gone)
            : TypedResults.File(state, "application/octet-stream");
    }

    private static async Task<IResult> Rename(
        Guid id,
        Guid snapshotId,
        RenameSnapshotRequest? request,
        IBoardSnapshotRepository snapshots,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!BoardSnapshot.TryNormalizeName(request?.Name, out var name) || name is null)
        {
            return InvalidName();
        }

        var snapshot = await snapshots.FindForUpdateAsync(id, snapshotId, cancellationToken);
        if (snapshot is null)
        {
            return TypedResults.NotFound();
        }

        if (snapshot.Kind != SnapshotKind.Manual)
        {
            return TypedResults.Problem("Only a saved version can be renamed.",
                statusCode: StatusCodes.Status409Conflict);
        }

        snapshot.Name = name;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var author = (await snapshots.FindAsync(id, snapshotId, cancellationToken))?.Author;
        return TypedResults.Ok(ToDto(snapshot, author));
    }

    private static async Task<IResult> Delete(
        Guid id,
        Guid snapshotId,
        IBoardSnapshotRepository snapshots,
        BoardSnapshotService service,
        IAuditLog audit,
        CancellationToken cancellationToken)
    {
        var snapshot = await snapshots.FindForUpdateAsync(id, snapshotId, cancellationToken);
        if (snapshot is null)
        {
            return TypedResults.NotFound();
        }

        // Staged before the removal commits, so the entry and the deletion are one transaction (#669).
        audit.Record(AuditActions.SnapshotDeleted,
            AuditActions.Board,
            id,
            new { snapshotId, kind = snapshot.Kind.ToString() });
        await service.RemoveAsync([snapshot], cancellationToken);
        return TypedResults.NoContent();
    }

    private static SnapshotDto ToDto(BoardSnapshot snapshot, string? author) =>
        new(snapshot.Id,
            snapshot.Kind.ToString(),
            snapshot.Name,
            author,
            snapshot.CreatedAt,
            snapshot.SizeBytes,
            snapshot.ElementCount);

    private static ValidationProblem InvalidName() =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = [$"The name must be 1 to {BoardSnapshot.MaxNameLength} characters."]
        });
}
