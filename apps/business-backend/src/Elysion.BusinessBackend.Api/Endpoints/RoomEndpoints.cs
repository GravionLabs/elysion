using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Rooms (ADR 0019): shared spaces that group boards. Listing and creating need only a signed-in user (creating
/// makes the caller the room's Owner), renaming needs Editor, deleting Owner; a caller with no role in a room gets
/// 404, not 403, as for boards. Moving a board into or out of a room is <c>PUT /boards/{id}/room</c>. Reached
/// through the BFF only.
/// </summary>
public static class RoomEndpoints
{
    public const int MaxNameLength = Room.MaxNameLength;

    public static IEndpointRouteBuilder MapRoomEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/rooms").WithTags("Rooms");

        group.MapGet("", List).WithName("ListRooms");
        group.MapPost("", Create)
            .WithName("CreateRoom")
            .Accepts<RoomNameRequest>("application/json")
            .RequireJsonContentType();
        group.MapPatch("/{id:guid}", Rename)
            .WithName("RenameRoom")
            .Accepts<RoomNameRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(RoomPolicies.Write);
        group.MapDelete("/{id:guid}", Delete).WithName("DeleteRoom").RequireAuthorization(RoomPolicies.Administer);

        routes.MapPut("/boards/{id:guid}/room", MoveBoard)
            .WithTags("Boards")
            .WithName("MoveBoardToRoom")
            .Accepts<MoveBoardRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(BoardPolicies.Write);
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<RoomDto>>> List(IRoomRepository rooms,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var all = await rooms.ListVisibleToAsync(user.Id, cancellationToken);
        var dtos = new List<RoomDto>(all.Count);
        foreach (var room in all)
        {
            // Visible means the caller has a role; the fallback only keeps the compiler honest.
            var role = await rooms.GetRoleAsync(room.Id, user.Id, cancellationToken) ?? BoardRole.Viewer;
            dtos.Add(RoomDto.From(room, role));
        }

        return TypedResults.Ok<IReadOnlyList<RoomDto>>(dtos);
    }

    private static async Task<Results<Created<RoomDto>, ValidationProblem>> Create(
        RoomNameRequest? request,
        HttpRequest http,
        IRoomRepository rooms,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (!Room.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var now = TruncateToMicroseconds(time.GetUtcNow());
        var room = Room.Create(Guid.CreateVersion7(), name, now, user.Id);
        // The explicit Owner membership as well, so the member list and later queries see the creator.
        room.Memberships.Add(RoomMembership.Create(room.Id, user.Id, BoardRole.Owner, now));
        rooms.Add(room);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/rooms/{room.Id}");
        return TypedResults.Created(location, RoomDto.From(room, BoardRole.Owner));
    }

    private static async Task<Results<Ok<RoomDto>, NotFound, ValidationProblem>> Rename(
        Guid id,
        RoomNameRequest? request,
        IRoomRepository rooms,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!Room.TryNormalizeName(request?.Name, out var name))
        {
            return InvalidName();
        }

        var room = await rooms.FindForUpdateAsync(id, cancellationToken);
        if (room is null)
        {
            return TypedResults.NotFound();
        }

        room.Name = name;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var role = await rooms.GetRoleAsync(id, user.Id, cancellationToken) ?? BoardRole.Editor;
        return TypedResults.Ok(RoomDto.From(room, role));
    }

    /// <summary>
    /// The room goes, its boards stay and leave it (the database sets <c>RoomId</c> to null; they are taken out
    /// here as well so the tracked boards and every provider agree).
    /// </summary>
    private static async Task<Results<NoContent, NotFound>> Delete(
        Guid id,
        IRoomRepository rooms,
        IBoardRepository boards,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
    {
        var room = await rooms.FindForUpdateAsync(id, cancellationToken);
        if (room is null)
        {
            return TypedResults.NotFound();
        }

        foreach (var board in await boards.ListInRoomForUpdateAsync(id, cancellationToken))
        {
            board.RoomId = null;
        }

        rooms.Remove(room);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Puts a board in a room, or takes it out (<c>roomId: null</c>). The caller needs <c>BoardWrite</c> on the board
    /// (the policy) and, for a room, Editor in it: no role there is a 404 (the room does not exist for them), a Viewer
    /// gets a 403.
    /// </summary>
    private static async Task<IResult> MoveBoard(
        Guid id,
        MoveBoardRequest? request,
        IBoardRepository boards,
        IRoomRepository rooms,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["roomId"] = ["Say which room, or null to take the board out of its room."],
            });
        }

        if (request.RoomId is { } roomId)
        {
            var role = await rooms.GetRoleAsync(roomId, user.Id, cancellationToken);
            if (role is null)
            {
                return TypedResults.Problem("The room does not exist.", statusCode: StatusCodes.Status404NotFound);
            }

            if (BoardPolicies.Rank(role.Value) < BoardPolicies.Rank(BoardRole.Editor))
            {
                return TypedResults.Problem("Your role in this room does not allow putting boards in it.",
                    statusCode: StatusCodes.Status403Forbidden);
            }
        }

        var board = await boards.FindForUpdateAsync(id, cancellationToken);
        if (board is null)
        {
            return TypedResults.NotFound();
        }

        board.RoomId = request.RoomId;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(BoardDto.From(board));
    }

    private static DateTimeOffset TruncateToMicroseconds(DateTimeOffset value) =>
        new(value.Ticks - value.Ticks % 10, value.Offset);

    private static ValidationProblem InvalidName() =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = [$"The name must be between 1 and {MaxNameLength} characters."],
        });
}
