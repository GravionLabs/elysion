using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

public static class EndpointExtensions
{
    /// <summary>
    /// Answers 415 when the request has no JSON content type, before the handler runs. Minimal APIs would
    /// answer 400 for a missing body; the API answered 415 as controllers, and callers rely on it. The body
    /// parameter has to be optional, or binding fails first.
    /// </summary>
    public static RouteHandlerBuilder RequireJsonContentType(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
            context.HttpContext.Request.HasJsonContentType()
                ? await next(context)
                : TypedResults.StatusCode(StatusCodes.Status415UnsupportedMediaType));
}
