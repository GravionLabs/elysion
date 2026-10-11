using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// What a person keeps about a board for themselves (#730): when they last opened it (the overview sorts by it) and a star (the
/// overview lists the starred boards first). Both need only the board's read role: they say nothing the board itself holds, and
/// nobody else sees them.
/// </summary>
public static class BoardUserStateEndpoints
{
    public static IEndpointRouteBuilder MapBoardUserStateEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards/{id:guid}").WithTags("Boards");

        // Written at most once per BoardUserStateRepositoryDefaults.VisitInterval; a call inside it is a 204 that writes nothing.
        group.MapPost("/open", Open).WithName("OpenBoard").RequireAuthorization(BoardPolicies.Read);
        group.MapPut("/favorite", Favorite).WithName("FavoriteBoard").RequireAuthorization(BoardPolicies.Read);
        group.MapDelete("/favorite", Unfavorite).WithName("UnfavoriteBoard").RequireAuthorization(BoardPolicies.Read);
        return routes;
    }

    private static async Task<IResult> Open(
        Guid id,
        IBoardUserStateRepository states,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var written = await states.RecordVisitAsync(id,
            user.Id,
            new DateTimeOffset(now.Ticks - now.Ticks % 10, now.Offset), // what Postgres keeps
            BoardUserStateRepositoryDefaults.VisitInterval,
            cancellationToken);
        if (written)
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return TypedResults.NoContent();
    }

    private static Task<IResult> Favorite(Guid id,
        IBoardUserStateRepository states,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken) =>
        SetAsync(id, true, states, unitOfWork, user, time, cancellationToken);

    private static Task<IResult> Unfavorite(Guid id,
        IBoardUserStateRepository states,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken) =>
        SetAsync(id, false, states, unitOfWork, user, time, cancellationToken);

    private static async Task<IResult> SetAsync(
        Guid id,
        bool favorite,
        IBoardUserStateRepository states,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        await states.SetFavoriteAsync(id, user.Id, favorite, time.GetUtcNow(), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }
}
