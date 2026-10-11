using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Tells the realtime service what role a person has on a board <em>now</em> (#772). A WS token carries the role at
/// the moment it was issued; an open socket outlives it, so the realtime service asks again while the socket is open
/// and closes or lowers it when the answer changed. Internal only, like the document API (ADR 0017): the edge does not
/// route <c>/internal</c> and the token is the realtime service's own.
/// </summary>
public static class BoardAccessEndpoints
{
    public static IEndpointRouteBuilder MapBoardAccessEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/internal/boards/{boardId}/access", Get)
            .WithTags("Board documents")
            .WithName("GetBoardAccess")
            .RequireAuthorization(InternalApiOptions.Policy);
        return routes;
    }

    /// <summary>
    /// The role of the person with the identity-provider subject <paramref name="sub"/>: 200 with the role, or 404 when
    /// the board does not exist, the person is unknown or has no role on it (the three look the same, as everywhere).
    /// </summary>
    private static async Task<Results<Ok<MembershipDto>, NotFound>> Get(
        string boardId,
        string? sub,
        IBoardRepository boards,
        IUserRepository users,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(boardId, out var id) || id == Guid.Empty || string.IsNullOrWhiteSpace(sub))
        {
            return TypedResults.NotFound();
        }

        var user = await users.FindBySubjectAsync(sub, cancellationToken);
        if (user is null)
        {
            return TypedResults.NotFound();
        }

        var role = await boards.GetRoleAsync(id, user.Id, cancellationToken);
        return role is null ? TypedResults.NotFound() : TypedResults.Ok(new MembershipDto(id, role.Value.ToString()));
    }
}
