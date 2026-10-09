using Serilog;
using Serilog.Events;
using Serilog.Sinks.OpenTelemetry;

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
        var viewer = ViewerEndpoint(builder.Configuration["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"]);
        var viewerHeaders = ParseOtlpHeaders(builder.Configuration["OTEL_EXPORTER_OTLP_LOGS_HEADERS"]);
        var level = ParseLevel(builder.Configuration["LOG_LEVEL"]);
        var json = (builder.Configuration["LOG_FORMAT"]?.ToLowerInvariant()) switch
        {
            "json" => true,
            "text" => false,
            _ => Console.IsOutputRedirected,
        };
        builder.Host.UseSerilog((_, services, configuration) =>
        {
            configuration
                .MinimumLevel.Is(level)
                // The request line replaces what these write for every request; their warnings and errors still show.
                .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
                .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
                // The service speaks plain HTTP behind the edge, which terminates TLS: the redirection has no HTTPS port to
                // find, says so with a warning, and that is neither news nor something an operator can act on.
                .MinimumLevel.Override("Microsoft.AspNetCore.HttpsPolicy.HttpsRedirectionMiddleware",
                    LogEventLevel.Error)
                .ReadFrom.Services(services)
                .Enrich.FromLogContext()
                .WriteTo.Console(json ? new ElysionJsonFormatter(ServiceName) : new ElysionTextFormatter());
            if (viewer is not null)
            {
                // The log viewer of the dev stack, next to stdout (ADR 0025): OTLP over HTTP, protobuf.
                configuration.WriteTo.Logger(viewerLogger => viewerLogger
                    .Enrich.With<LevelWordEnricher>()
                    .WriteTo.OpenTelemetry(options =>
                    {
                        options.Endpoint = viewer;
                        options.Protocol = OtlpProtocol.HttpProtobuf;
                        // Without this header the viewer makes every resource attribute the stream key.
                        options.Headers = new Dictionary<string, string> { ["VL-Stream-Fields"] = "service.name" }
                            .Concat(viewerHeaders)
                            .ToDictionary(pair => pair.Key, pair => pair.Value);
                        options.ResourceAttributes = new Dictionary<string, object> { ["service.name"] = ServiceName };
                    }));
            }
        });
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

    /// <summary><c>OTEL_EXPORTER_OTLP_LOGS_ENDPOINT</c>: null when unset (nothing is sent); a setting that is no http(s) URL stops the start.</summary>
    internal static string? ViewerEndpoint(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException(
                $"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT must be an http(s) URL, got \"{value}\".");
        }

        return uri.ToString();
    }

    /// <summary><c>OTEL_EXPORTER_OTLP_LOGS_HEADERS</c>: <c>name=value,name2=value2</c>; anything that is not a pair is ignored.</summary>
    internal static IReadOnlyDictionary<string, string> ParseOtlpHeaders(string? value)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in (value ?? "").Split(','))
        {
            var separator = pair.IndexOf('=', StringComparison.Ordinal);
            if (separator > 0)
            {
                headers[pair[..separator].Trim()] = Uri.UnescapeDataString(pair[(separator + 1)..].Trim());
            }
        }

        return headers;
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
