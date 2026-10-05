namespace Elysion.BusinessBackend.Api.Endpoints;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }))
            .WithName("GetHealth")
            .WithTags("Health");
        return routes;
    }
}
