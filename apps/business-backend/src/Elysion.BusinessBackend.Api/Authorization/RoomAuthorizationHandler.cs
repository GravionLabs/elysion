using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>
/// Resource-based authorization over room membership: answers "may this user read, rename or administer this room?"
/// from the caller's role in the room in the route (<c>{id}</c>). A caller with no role gets "not found", as for
/// boards (<see cref="BoardAuthorizationResultHandler"/>), so room ids cannot be probed either.
/// </summary>
public sealed class RoomAuthorizationHandler(IRoomRepository rooms, ICurrentUser currentUser)
    : AuthorizationHandler<RoomRoleRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context,
        RoomRoleRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (context.Resource is not HttpContext http
            || http.GetRouteValue("id") is not string raw
            || !Guid.TryParse(raw, out var roomId))
        {
            context.Fail();
            return;
        }

        var role = await rooms.GetRoleAsync(roomId, currentUser.Id, http.RequestAborted);
        if (role is null)
        {
            context.Fail(new AuthorizationFailureReason(this, BoardAuthorizationResultHandler.NotVisible));
            return;
        }

        if (BoardPolicies.Rank(role.Value) >= BoardPolicies.Rank(requirement.Minimum))
        {
            context.Succeed(requirement);
        }
        else
        {
            context.Fail(new AuthorizationFailureReason(this, "Your role in this room does not allow that."));
        }
    }
}
