using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// The groups that have a role in a room (ADR 0027): everybody who can see the room sees the list, only its owners change it.
/// A group's members get the role on the room and its boards next to what they have as people; the highest counts. The list of a
/// room's people (<see cref="RoomMemberEndpoints"/>) is unchanged.
/// </summary>
public static class RoomGroupEndpoints
{
    public static IEndpointRouteBuilder MapRoomGroupEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/rooms/{id:guid}/groups").WithTags("Room groups");

        group.MapGet("", List).WithName("ListRoomGroups").RequireAuthorization(RoomPolicies.Read);
        group.MapPut("/{groupId:guid}", Set)
            .WithName("SetRoomGroupRole")
            .Accepts<RoomGroupRoleRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(RoomPolicies.Administer);
        group.MapDelete("/{groupId:guid}", Remove)
            .WithName("RemoveRoomGroup")
            .RequireAuthorization(RoomPolicies.Administer);
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<RoomGroupDto>>> List(Guid id,
        IGroupRepository groups,
        CancellationToken cancellationToken)
    {
        var list = await groups.ListForRoomAsync(id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<RoomGroupDto>>(
            list.Select(g => new RoomGroupDto(g.GroupId, g.GroupName, g.Role.ToString())).ToList());
    }

    private static async Task<IResult> Set(
        Guid id,
        Guid groupId,
        RoomGroupRoleRequest? request,
        IGroupRepository groups,
        IUnitOfWork unitOfWork,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (!BoardMemberEndpoints.TryParseRole(request?.Role, out var role))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = [BoardMemberEndpoints.RoleMessage]
            });
        }

        var group = await groups.FindAsync(groupId, cancellationToken);
        if (group is null)
        {
            return TypedResults.Problem("There is no such group.", statusCode: StatusCodes.Status404NotFound);
        }

        await groups.SetRoomRoleAsync(id, groupId, role, time.GetUtcNow(), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(new RoomGroupDto(group.Id, group.Name, role.ToString()));
    }

    private static async Task<IResult> Remove(
        Guid id,
        Guid groupId,
        IGroupRepository groups,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
    {
        if (!await groups.RemoveRoomRoleAsync(id, groupId, cancellationToken))
        {
            return TypedResults.Problem("This group has no role in the room.",
                statusCode: StatusCodes.Status404NotFound);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }
}
