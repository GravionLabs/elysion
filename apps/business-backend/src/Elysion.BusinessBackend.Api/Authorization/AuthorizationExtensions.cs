using Elysion.BusinessBackend.Api.Entities;

using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Authorization;

public static class AuthorizationExtensions
{
    /// <summary>Registers the read, write and administer policies and what evaluates them.</summary>
    public static IServiceCollection AddBoardAuthorization(this IServiceCollection services)
    {
        services.AddScoped<IAuthorizationHandler, BoardAuthorizationHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, BoardAuthorizationResultHandler>();
        services.AddAuthorizationBuilder()
            .AddPolicy(BoardPolicies.Read,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new BoardRoleRequirement(BoardRole.Viewer)))
            .AddPolicy(BoardPolicies.Write,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new BoardRoleRequirement(BoardRole.Editor)))
            .AddPolicy(BoardPolicies.Administer,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new BoardRoleRequirement(BoardRole.Owner)));
        return services;
    }
}
