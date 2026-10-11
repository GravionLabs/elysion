using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>The policy of the <c>/admin</c> area (ADR 0027).</summary>
public static class AdminPolicies
{
    /// <summary>The caller has the realm role named by <c>OIDC_ADMIN_ROLE</c>. It is never consulted for a role on a board or a room.</summary>
    public const string InstanceAdminister = "InstanceAdminister";
}

/// <summary>Requirement of <see cref="AdminPolicies.InstanceAdminister"/>.</summary>
public sealed class InstanceAdministerRequirement : IAuthorizationRequirement;

public sealed class InstanceAdministerHandler(IOptions<OidcOptions> oidc)
    : AuthorizationHandler<InstanceAdministerRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context,
        InstanceAdministerRequirement requirement)
    {
        var role = oidc.Value.AdminRole;
        if (!string.IsNullOrWhiteSpace(role) && context.User.IsInRole(role.Trim()))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
