using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Members;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Who is in a room and as what, with the rules of the board member API (<see cref="BoardMemberEndpoints"/>). Every
/// endpoint needs the room's administer policy (Owner): somebody with a lower role, or none, gets 403 or 404.
/// </summary>
public static class RoomMemberEndpoints
{
    private const string Noun = "room";

    public static IEndpointRouteBuilder MapRoomMemberEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/rooms/{id:guid}/members")
            .WithTags("Room members")
            .RequireAuthorization(RoomPolicies.Administer);

        group.MapGet("", List).WithName("ListRoomMembers");
        group.MapPost("", Add)
            .WithName("AddRoomMember")
            .Accepts<AddMemberRequest>("application/json")
            .RequireJsonContentType();
        group.MapPatch("/{userId:guid}", ChangeRole)
            .WithName("ChangeRoomMemberRole")
            .Accepts<ChangeRoleRequest>("application/json")
            .RequireJsonContentType();
        group.MapDelete("/{userId:guid}", Remove).WithName("RemoveRoomMember");
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<MemberDto>>> List(Guid id,
        RoomMemberService members,
        CancellationToken cancellationToken)
    {
        var list = await members.ListAsync(id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<MemberDto>>(list.Select(BoardMemberEndpoints.ToDto).ToList());
    }

    private static async Task<IResult> Add(Guid id,
        AddMemberRequest? request,
        RoomMemberService members,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request?.Email))
            errors["email"] = ["An email is needed."];
        if (!BoardMemberEndpoints.TryParseRole(request?.Role, out var role))
            errors["role"] = [BoardMemberEndpoints.RoleMessage];
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        var result = await members.AddAsync(id, request!.Email!, role, cancellationToken);
        return result.Succeeded
            ? TypedResults.Created($"/rooms/{id}/members/{result.Member!.UserId}",
                BoardMemberEndpoints.ToDto(result.Member))
            : BoardMemberEndpoints.Refusal(result, Noun);
    }

    private static async Task<IResult> ChangeRole(
        Guid id,
        Guid userId,
        ChangeRoleRequest? request,
        RoomMemberService members,
        CancellationToken cancellationToken)
    {
        if (!BoardMemberEndpoints.TryParseRole(request?.Role, out var role))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = [BoardMemberEndpoints.RoleMessage]
            });
        }

        var result = await members.ChangeRoleAsync(id, userId, role, cancellationToken);
        return result.Succeeded
            ? TypedResults.Ok(BoardMemberEndpoints.ToDto(result.Member!))
            : BoardMemberEndpoints.Refusal(result, Noun);
    }

    private static async Task<IResult> Remove(Guid id,
        Guid userId,
        RoomMemberService members,
        CancellationToken cancellationToken)
    {
        var result = await members.RemoveAsync(id, userId, cancellationToken);
        return result.Succeeded ? TypedResults.NoContent() : BoardMemberEndpoints.Refusal(result, Noun);
    }
}
