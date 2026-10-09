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

    public async Task InvokeAsync(HttpContext context)
    {
        var subject = context.User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(subject))
        {
            await next(context);
            return;
        }

        using (LogContext.PushProperty(PropertyName, subject))
        {
            await next(context);
        }
    }
}
