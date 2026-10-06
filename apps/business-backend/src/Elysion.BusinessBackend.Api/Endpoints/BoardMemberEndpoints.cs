using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Members;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Who may open a board and as what. Every endpoint needs the administer policy (Owner): somebody with a lower
/// role, or none, gets 403 or 404 as for any board endpoint (<see cref="BoardAuthorizationResultHandler"/>).
/// </summary>
public static class BoardMemberEndpoints
{
    public static IEndpointRouteBuilder MapBoardMemberEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards/{id:guid}/members")
            .WithTags("Board members")
            .RequireAuthorization(BoardPolicies.Administer);

        group.MapGet("", List).WithName("ListBoardMembers");
        group.MapPost("", Add)
            .WithName("AddBoardMember")
            .Accepts<AddMemberRequest>("application/json")
            .RequireJsonContentType();
        group.MapPatch("/{userId:guid}", ChangeRole)
            .WithName("ChangeBoardMemberRole")
            .Accepts<ChangeRoleRequest>("application/json")
            .RequireJsonContentType();
        group.MapDelete("/{userId:guid}", Remove).WithName("RemoveBoardMember");
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<MemberDto>>> List(Guid id,
        BoardMemberService members,
        CancellationToken cancellationToken)
    {
        var list = await members.ListAsync(id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<MemberDto>>(list.Select(ToDto).ToList());
    }

    private static async Task<IResult> Add(Guid id,
        AddMemberRequest? request,
        BoardMemberService members,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request?.Email))
            errors["email"] = ["An email is needed."];
        if (!TryParseRole(request?.Role, out var role))
            errors["role"] = [RoleMessage];
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        var result = await members.AddAsync(id, request!.Email!, role, cancellationToken);
        return result.Succeeded
            ? TypedResults.Created($"/boards/{id}/members/{result.Member!.UserId}", ToDto(result.Member))
            : Refusal(result);
    }

    private static async Task<IResult> ChangeRole(
        Guid id,
        Guid userId,
        ChangeRoleRequest? request,
        BoardMemberService members,
        CancellationToken cancellationToken)
    {
        if (!TryParseRole(request?.Role, out var role))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["role"] = [RoleMessage] });
        }

        var result = await members.ChangeRoleAsync(id, userId, role, cancellationToken);
        return result.Succeeded ? TypedResults.Ok(ToDto(result.Member!)) : Refusal(result);
    }

    private static async Task<IResult> Remove(Guid id,
        Guid userId,
        BoardMemberService members,
        CancellationToken cancellationToken)
    {
        var result = await members.RemoveAsync(id, userId, cancellationToken);
        return result.Succeeded ? TypedResults.NoContent() : Refusal(result);
    }

    private const string RoleMessage = "The role must be Owner, Editor or Viewer.";

    /// <summary>Only the names count: <c>Enum.TryParse</c> would accept "1" or "7" as well.</summary>
    private static bool TryParseRole(string? text, out BoardRole role)
    {
        role = default;
        var name = text?.Trim();
        return name is { Length: > 0 }
               && Enum.GetNames<BoardRole>().Any(n => string.Equals(n, name, StringComparison.OrdinalIgnoreCase))
               && Enum.TryParse(name, ignoreCase: true, out role);
    }

    /// <summary>Why the request was refused, as a problem with a message the UI can show.</summary>
    private static ProblemHttpResult Refusal(MemberResult result) => result.Outcome switch
    {
        MemberOutcome.UnknownEmail => Problem(StatusCodes.Status404NotFound,
            "No user with this email has logged in to Elysion yet. They have to log in once before they can be added."),
        MemberOutcome.NotAMember => Problem(StatusCodes.Status404NotFound, "This user is not a member of the board."),
        MemberOutcome.AmbiguousEmail => Problem(StatusCodes.Status409Conflict, "More than one user has this email."),
        MemberOutcome.AlreadyMember => Problem(StatusCodes.Status409Conflict,
            "This user is a member of the board already; change their role instead."),
        MemberOutcome.CreatorStaysOwner => Problem(StatusCodes.Status409Conflict,
            "The creator of a board stays its owner: their role cannot be changed or removed."),
        MemberOutcome.LastOwner => Problem(StatusCodes.Status409Conflict,
            "A board needs at least one owner: the last owner cannot be removed or demoted."),
        _ => throw new InvalidOperationException($"Unhandled outcome {result.Outcome}."),
    };

    private static ProblemHttpResult Problem(int status, string detail) =>
        TypedResults.Problem(detail, statusCode: status);

    private static MemberDto ToDto(MemberView member) =>
        new(member.UserId, member.DisplayName, member.Email, member.Role.ToString());
}
