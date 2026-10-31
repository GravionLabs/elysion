using Elysion.BusinessBackend.Api.AccessTokens;

using Serilog.Context;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// After authentication: the token's <c>sub</c> (and nothing else about the person) goes into the log context, so the
/// lines of an authenticated request say whose request it was (ADR 0025).
/// </summary>
public sealed class UserIdLogMiddleware(RequestDelegate next)
{
    /// <summary>The log property that carries the subject.</summary>
    public const string PropertyName = "userId";

    /// <summary>The log property with the id of the personal access token of the request.</summary>
    public const string TokenIdPropertyName = "tokenId";

    public async Task InvokeAsync(HttpContext context)
    {
        var subject = context.User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(subject))
        {
            await next(context);
            return;
        }

        // A request made with a personal access token also says which one (ADR 0033): its id, never the token.
        var tokenId = context.User.FindFirst(AccessTokenAuthenticationHandler.TokenIdClaim)?.Value;
        using (LogContext.PushProperty(PropertyName, subject))
        using (tokenId is null ? null : LogContext.PushProperty(TokenIdPropertyName, tokenId))
        {
            await next(context);
        }
    }
}
