using Amazon.Runtime;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Snapshots;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Http.Extensions;

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
        group.MapDelete("/{snapshotId:guid}", Delete)
            .WithName("DeleteBoardSnapshot")
            .RequireAuthorization(BoardPolicies.Administer);
        return routes;
    }

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
