using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Identity;
using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>
/// Resource-based authorization over board membership: answers "may this user read, write or administer this
/// board?" from the caller's role on the board in the route (<c>{id}</c>).
/// </summary>
public sealed class BoardAuthorizationHandler(IBoardRepository boards, ICurrentUser currentUser)
    : AuthorizationHandler<BoardRoleRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, BoardRoleRequirement requirement)
    {
        // Not signed in: no verdict here, the authentication requirement of the policy produces the 401.
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (context.Resource is not HttpContext http
            || http.GetRouteValue("id") is not string raw
            || !Guid.TryParse(raw, out var boardId))
        {
            context.Fail();
            return;
        }

        var role = await boards.GetRoleAsync(boardId, currentUser.Id, http.RequestAborted);
        if (role is null)
        {
            // No role at all: the user is no member (or the board does not exist). This is reported as "not found"
            // by BoardAuthorizationResultHandler, deliberately and not as "forbidden": a 403 would tell a stranger
            // that this board id exists. A member whose role is too low does get a 403, they know the board.
            context.Fail(new AuthorizationFailureReason(this, BoardAuthorizationResultHandler.NotVisible));
            return;
        }

        if (BoardPolicies.Rank(role.Value) >= BoardPolicies.Rank(requirement.Minimum))
        {
            context.Succeed(requirement);
        }
        else
        {
            context.Fail(new AuthorizationFailureReason(this, "Your role on this board does not allow that."));
        }
    }
}
