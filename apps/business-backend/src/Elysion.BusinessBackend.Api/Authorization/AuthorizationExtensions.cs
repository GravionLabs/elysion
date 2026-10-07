using Elysion.BusinessBackend.Api.Entities;

using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Authorization;

public static class AuthorizationExtensions
{
    /// <summary>Registers the read, write and administer policies of boards and rooms and what evaluates them.</summary>
    public static IServiceCollection AddBoardAuthorization(this IServiceCollection services)
    {
        services.AddScoped<IAuthorizationHandler, BoardAuthorizationHandler>();
        services.AddScoped<IAuthorizationHandler, RoomAuthorizationHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, BoardAuthorizationResultHandler>();
        services.AddAuthorizationBuilder()
            .AddPolicy(BoardPolicies.Read,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new BoardRoleRequirement(BoardRole.Viewer)))
            .AddPolicy(BoardPolicies.Write,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new BoardRoleRequirement(BoardRole.Editor)))
            .AddPolicy(BoardPolicies.Administer,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new BoardRoleRequirement(BoardRole.Owner)))
            .AddPolicy(RoomPolicies.Read,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new RoomRoleRequirement(BoardRole.Viewer)))
            .AddPolicy(RoomPolicies.Write,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new RoomRoleRequirement(BoardRole.Editor)))
            .AddPolicy(RoomPolicies.Administer,
                policy => policy.RequireAuthenticatedUser().AddRequirements(new RoomRoleRequirement(BoardRole.Owner)));
        return services;
    }
}
