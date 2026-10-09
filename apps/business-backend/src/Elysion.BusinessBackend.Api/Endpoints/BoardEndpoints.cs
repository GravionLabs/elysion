using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Files;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Board CRUD behind the board policies (<see cref="BoardPolicies"/>): creating a board makes the caller its
/// Owner, the list holds only the caller's boards, reading needs a role, renaming needs Editor, deleting
/// needs Owner. A caller with no role on a board gets 404, not 403 (<see cref="BoardAuthorizationResultHandler"/>).
/// Reached through the BFF only.
/// </summary>
public static class BoardEndpoints
{
    public const int MaxNameLength = Board.MaxNameLength;

    public static IEndpointRouteBuilder MapBoardEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards").WithTags("Boards");

        group.MapGet("", List).WithName("ListBoards");
        group.MapGet("/{id:guid}", Get).WithName("GetBoard").RequireAuthorization(BoardPolicies.Read);
        group.MapGet("/{id:guid}/membership/me", MyMembership)
            .WithName("GetMyMembership")
            .RequireAuthorization(BoardPolicies.Read);
        group.MapPost("", Create)
            .WithName("CreateBoard")
            .Accepts<BoardNameRequest>("application/json")
            .RequireJsonContentType();
        group.MapPatch("/{id:guid}", Rename)
            .WithName("RenameBoard")
            .Accepts<BoardNameRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(BoardPolicies.Write);
        group.MapPost("/{id:guid}/duplicate", Duplicate)
            .WithName("DuplicateBoard")
            .RequireAuthorization(BoardPolicies.Read);
        group.MapDelete("/{id:guid}", Delete).WithName("DeleteBoard").RequireAuthorization(BoardPolicies.Administer);
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<BoardDto>>> List(IBoardRepository boards,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var all = await boards.ListVisibleToAsync(user.Id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<BoardDto>>(all.Select(BoardDto.From).ToList());
    }

    private static async Task<Results<Ok<BoardDto>, NotFound>> Get(Guid id,
        IBoardRepository boards,
        CancellationToken cancellationToken)
    {
        var board = await boards.FindAsync(id, cancellationToken);
        return board is null ? TypedResults.NotFound() : TypedResults.Ok(BoardDto.From(board));
    }

    /// <summary>The caller's role on the board in the route, for the BFF's WS token check (#120). 404 for non-members.</summary>
    private static async Task<Results<Ok<MembershipDto>, NotFound>> MyMembership(
        Guid id,
        IBoardRepository boards,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var role = await boards.GetRoleAsync(id, user.Id, cancellationToken);
        return role is null ? TypedResults.NotFound() : TypedResults.Ok(new MembershipDto(id, role.Value.ToString()));
    }

    private static async Task<Results<Created<BoardDto>, ValidationProblem>> Create(
        BoardNameRequest? request,
        HttpRequest http,
        IBoardRepository boards,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (!Board.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var board = NewOwnedBoard(name, user, TruncateToMicroseconds(time.GetUtcNow()));
        boards.Add(board);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        // An absolute Location, as CreatedAtAction produced.
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/boards/{board.Id}");
        return TypedResults.Created(location, BoardDto.From(board));
    }

    private static async Task<Results<Ok<BoardDto>, NotFound, ValidationProblem>> Rename(
        Guid id,
        BoardNameRequest? request,
        IBoardRepository boards,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
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
        Guid id,
        HttpRequest http,
        IBoardRepository boards,
        IBoardDocumentRepository documents,
        IFileStore files,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var source = await boards.FindAsync(id, cancellationToken);
        if (source is null)
        {
            return TypedResults.NotFound();
        }

        var now = TruncateToMicroseconds(time.GetUtcNow());
        // The copy is the caller's own board, whoever owns the source.
        var copy = NewOwnedBoard(CopyName(source.Name), user, now);
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
        // The images the copy's document refers to (the files of the source, under the same ids).
        await files.CopyPrefixAsync(FileTypes.Prefix(id), FileTypes.Prefix(copy.Id), cancellationToken);
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/boards/{copy.Id}");
        return TypedResults.Created(location, BoardDto.From(copy));
    }

    /// <summary>A board owned by <paramref name="owner"/>, with the explicit Owner membership that sharing lists will show.</summary>
    private static Board NewOwnedBoard(string name, ICurrentUser owner, DateTimeOffset now)
    {
        var board = Board.Create(Guid.CreateVersion7(), name, now, owner.Id);
        board.Memberships.Add(BoardMembership.Create(board.Id, owner.Id, BoardRole.Owner, now));
        return board;
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
        Guid id,
        IBoardRepository boards,
        IBoardDocumentRepository documents,
        IFileStore files,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
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
        // The files go with the board; they are only reachable through it.
        await files.DeletePrefixAsync(FileTypes.Prefix(id), cancellationToken);
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
