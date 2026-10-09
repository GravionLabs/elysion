using System.Text.RegularExpressions;

using Serilog.Context;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// Gives every request an id (ADR 0025): the <c>X-Request-Id</c> of the request when it is well formed (the BFF sends
/// one), a new one otherwise. The id is echoed in the response and put into the log context, so every log line of the
/// request carries it. A value that does not match <see cref="IsValid"/> is replaced, never logged: a client must not
/// be able to write anything it likes into the logs.
/// </summary>
public sealed partial class RequestIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Request-Id";

    /// <summary>The log property that carries the id. Not <c>RequestId</c>: ASP.NET Core's hosting scope uses that name for its own trace id.</summary>
    public const string PropertyName = "requestId";

    public static bool IsValid(string? value) => value is not null && Pattern().IsMatch(value);

    [GeneratedRegex("^[A-Za-z0-9._-]{8,64}$")]
    private static partial Regex Pattern();

    public async Task InvokeAsync(HttpContext context)
    {
        var incoming = context.Request.Headers[HeaderName].ToString();
        var requestId = IsValid(incoming) ? incoming : Guid.NewGuid().ToString("D");
        context.Response.Headers[HeaderName] = requestId;
        using (LogContext.PushProperty(PropertyName, requestId))
        {
            await next(context);
        }
    }
}
