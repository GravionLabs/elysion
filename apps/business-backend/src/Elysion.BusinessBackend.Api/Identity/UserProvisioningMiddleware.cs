using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Once per authenticated request: resolves the caller to a local user and puts it into
/// <see cref="ICurrentUser"/>. Runs after authentication and before authorization (which will use the user).
/// Requests that are not authenticated, and endpoints that are anonymous (health, the internal API), are
/// left alone: they never need a user and must not write to the database.
/// </summary>
public sealed class UserProvisioningMiddleware(RequestDelegate next)
{
    /// <summary>The <c>code</c> of the problem a deactivated person gets with their 403; the BFF passes it on and the shell shows a page for it.</summary>
    public const string AccountDeactivatedCode = "account-deactivated";

    public async Task InvokeAsync(
        HttpContext context,
        UserProvisioningService provisioning,
        CurrentUserAccessor accessor,
        IOptions<OidcOptions> oidc)
    {
        var anonymousEndpoint = context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is not null;
        if (context.User.Identity?.IsAuthenticated == true && !anonymousEndpoint)
        {
            var user = await provisioning.ProvisionAsync(context.User, context.RequestAborted);
            if (user is null)
            {
                // A valid token without a usable `sub` is no identity: treat it as not authenticated.
                await Results.Unauthorized().ExecuteAsync(context);
                return;
            }

            if (user.IsDeactivated)
            {
                // Valid token, deactivated person (#668): nothing works, and the shell is told why with a code it can recognise.
                await Results.Problem(
                        "An administrator has deactivated this account. Ask them to reactivate it.",
                        statusCode: StatusCodes.Status403Forbidden,
                        title: "Account deactivated",
                        extensions: new Dictionary<string, object?> { ["code"] = AccountDeactivatedCode })
                    .ExecuteAsync(context);
                return;
            }

            var adminRole = oidc.Value.AdminRole;
            accessor.Set(user, !string.IsNullOrWhiteSpace(adminRole) && context.User.IsInRole(adminRole.Trim()));
        }

        await next(context);
    }
}
