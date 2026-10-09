using Serilog;
using Serilog.Events;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// Logging for the business backend (ADR 0025, docs/specs/business-backend.md "Logging"): Serilog replaces the
/// framework's logger, writes one JSON line per event to stdout (readable text in a terminal), and logs one line per
/// request instead of ASP.NET Core's several.
/// </summary>
public static class RequestLogging
{
    public const string ServiceName = "elysion-business-backend";

    /// <summary>The log property that carries the route pattern of a request (<c>/boards/{id}</c>), never its URL.</summary>
    public const string RoutePropertyName = "HttpRoute";

    /// <summary>
    /// <c>LOG_LEVEL</c> (<c>trace</c> to <c>fatal</c>, default <c>info</c>) and <c>LOG_FORMAT</c> (<c>json</c> or
    /// <c>text</c>; <c>text</c> when stdout is a terminal, <c>json</c> otherwise). Log sinks registered as
    /// <see cref="Serilog.Core.ILogEventSink"/> services are added, which is how the tests read the output.
    /// </summary>
    public static WebApplicationBuilder AddElysionLogging(this WebApplicationBuilder builder)
    {
        var level = ParseLevel(builder.Configuration["LOG_LEVEL"]);
        var json = (builder.Configuration["LOG_FORMAT"]?.ToLowerInvariant()) switch
        {
            "json" => true,
            "text" => false,
            _ => Console.IsOutputRedirected,
        };
        builder.Host.UseSerilog((_, services, configuration) => configuration
            .MinimumLevel.Is(level)
            // The request line replaces what these write for every request; their warnings and errors still show.
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
            .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
            // The service speaks plain HTTP behind the edge, which terminates TLS: the redirection has no HTTPS port to
            // find, says so with a warning, and that is neither news nor something an operator can act on.
            .MinimumLevel.Override("Microsoft.AspNetCore.HttpsPolicy.HttpsRedirectionMiddleware", LogEventLevel.Error)
            .ReadFrom.Services(services)
            .Enrich.FromLogContext()
            .WriteTo.Console(json ? new ElysionJsonFormatter(ServiceName) : new ElysionTextFormatter()));
        return builder;
    }

    /// <summary>
    /// Request id first (every later line carries it), then the one line per request, then (after authentication, see
    /// <see cref="UserIdLogMiddleware"/>) the subject. Health checks log at debug: they run every few seconds.
    /// </summary>
    public static WebApplication UseElysionRequestId(this WebApplication app)
    {
        app.UseMiddleware<RequestIdMiddleware>();
        app.UseSerilogRequestLogging(options =>
        {
            options.MessageTemplate = "HTTP {RequestMethod} {HttpRoute} responded {StatusCode} in {Elapsed:0.0} ms";
            options.GetLevel = (context, _, exception) =>
                exception is not null || context.Response.StatusCode >= 500 ? LogEventLevel.Error
                : context.Request.Path.StartsWithSegments("/health", StringComparison.Ordinal) ? LogEventLevel.Debug
                : LogEventLevel.Information;
            options.EnrichDiagnosticContext = (diagnostics, context) =>
            {
                diagnostics.Set(RoutePropertyName, RouteOf(context));
                var subject = context.User.FindFirst("sub")?.Value;
                if (!string.IsNullOrEmpty(subject))
                {
                    diagnostics.Set(UserIdLogMiddleware.PropertyName, subject);
                }
            };
        });
        return app;
    }

    // A route group with an empty child pattern has the raw text "/boards/": the log says "/boards".
    private static string RouteOf(HttpContext context)
    {
        var pattern = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText;
        if (string.IsNullOrEmpty(pattern))
        {
            return "unmatched";
        }

        return pattern.Length > 1 ? pattern.TrimEnd('/') : pattern;
    }

    private static LogEventLevel ParseLevel(string? value) => value?.ToLowerInvariant() switch
    {
        "trace" or "verbose" => LogEventLevel.Verbose,
        "debug" => LogEventLevel.Debug,
        "warn" or "warning" => LogEventLevel.Warning,
        "error" => LogEventLevel.Error,
        "fatal" => LogEventLevel.Fatal,
        _ => LogEventLevel.Information,
    };
}
