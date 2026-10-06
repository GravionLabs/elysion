using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Once per authenticated request: resolves the caller to a local user and puts it into
/// <see cref="ICurrentUser"/>. Runs after authentication and before authorization (which will use the user).
/// Requests that are not authenticated, and endpoints that are anonymous (health, the internal API), are
/// left alone: they never need a user and must not write to the database.
/// </summary>
public sealed class UserProvisioningMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(
        HttpContext context,
        UserProvisioningService provisioning,
        CurrentUserAccessor accessor)
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

            accessor.Set(user);
        }

        await next(context);
    }
}
