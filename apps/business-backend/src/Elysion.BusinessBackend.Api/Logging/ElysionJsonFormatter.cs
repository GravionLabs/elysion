using System.Globalization;
using System.Text.Encodings.Web;
using System.Text;
using System.Text.Json;

using Serilog.Events;
using Serilog.Formatting;
using Serilog.Parsing;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// One JSON object per line, in the shape all three services share (ADR 0025): <c>timestamp</c> (ISO 8601, UTC),
/// <c>level</c> (<c>trace</c> to <c>fatal</c>), <c>service</c>, <c>requestId</c>, <c>message</c>, <c>userId</c>, and
/// <c>err</c> (<c>type</c>, <c>message</c>, <c>stack</c>) for an exception. The line of a finished request adds
/// <c>http</c> (<c>method</c>, <c>route</c>, <c>status</c>, <c>durationMs</c>). Other properties of the event follow
/// with their names in camel case. The request path is not written: the route pattern says which endpoint it was.
/// </summary>
public sealed class ElysionJsonFormatter(string service) : ITextFormatter
{
    // The properties this formatter writes itself, and the ones nobody should have to read: ASP.NET Core's hosting
    // scope adds its own RequestId (a trace id), RequestPath, ConnectionId and the trace fields to every line.
    private static readonly HashSet<string> Handled = new(StringComparer.Ordinal)
    {
        RequestIdMiddleware.PropertyName, UserIdLogMiddleware.PropertyName, "SourceContext",
        "RequestMethod", "RequestPath", "StatusCode", "Elapsed", RequestLogging.RoutePropertyName,
        "RequestId", "ConnectionId", "SpanId", "TraceId", "ParentId",
    };

    public void Format(LogEvent logEvent, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(logEvent);
        ArgumentNullException.ThrowIfNull(output);

        using var stream = new MemoryStream();
        // A log line is not HTML: quotes and plus signs stay readable instead of becoming \u0022 and \u002B.
        using (var json = new Utf8JsonWriter(stream,
                   new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            json.WriteStartObject();
            json.WriteString("timestamp",
                logEvent.Timestamp.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
            json.WriteString("level", LevelName(logEvent.Level));
            json.WriteString("service", service);
            WriteText(json, "requestId", logEvent, RequestIdMiddleware.PropertyName);
            json.WriteString("message", RenderMessage(logEvent));
            WriteText(json, "userId", logEvent, UserIdLogMiddleware.PropertyName);
            WriteText(json, "logger", logEvent, "SourceContext");
            WriteHttp(json, logEvent);
            WriteException(json, logEvent.Exception);
            foreach (var (name, value) in logEvent.Properties)
            {
                if (Handled.Contains(name))
                {
                    continue;
                }

                json.WritePropertyName(CamelCase(name));
                WriteValue(json, value);
            }

            json.WriteEndObject();
        }

        output.Write(System.Text.Encoding.UTF8.GetString(stream.GetBuffer(), 0, (int)stream.Length));
        output.Write('\n');
    }

    /// <summary>
    /// The message with its values filled in. Serilog puts quotes around a string value by default (<c>"GET"</c>); a log
    /// line for people and for a viewer reads better without them, and the value is in its own field anyway.
    /// </summary>
    public static string RenderMessage(LogEvent logEvent)
    {
        ArgumentNullException.ThrowIfNull(logEvent);
        var text = new StringBuilder();
        foreach (var token in logEvent.MessageTemplate.Tokens)
        {
            switch (token)
            {
                case PropertyToken property when logEvent.Properties.TryGetValue(property.PropertyName, out var value):
                    text.Append(value is ScalarValue { Value: string literal }
                        ? literal
                        : value.ToString(property.Format, CultureInfo.InvariantCulture));
                    break;
                default:
                    text.Append(token.ToString());
                    break;
            }
        }

        return text.ToString();
    }

    public static string LevelName(LogEventLevel level) => level switch
    {
        LogEventLevel.Verbose => "trace",
        LogEventLevel.Debug => "debug",
        LogEventLevel.Information => "info",
        LogEventLevel.Warning => "warn",
        LogEventLevel.Error => "error",
        _ => "fatal",
    };

    private static void WriteText(Utf8JsonWriter json, string name, LogEvent logEvent, string property)
    {
        if (logEvent.Properties.TryGetValue(property, out var value) && value is ScalarValue { Value: string text })
        {
            json.WriteString(name, text);
        }
    }

    private static void WriteHttp(Utf8JsonWriter json, LogEvent logEvent)
    {
        if (!logEvent.Properties.TryGetValue("StatusCode", out var status) ||
            status is not ScalarValue { Value: int code })
        {
            return;
        }

        json.WriteStartObject("http");
        WriteText(json, "method", logEvent, "RequestMethod");
        WriteText(json, "route", logEvent, RequestLogging.RoutePropertyName);
        json.WriteNumber("status", code);
        if (logEvent.Properties.TryGetValue("Elapsed", out var elapsed) && elapsed is ScalarValue { Value: double ms })
        {
            json.WriteNumber("durationMs", Math.Round(ms, 1));
        }

        json.WriteEndObject();
    }

    private static void WriteException(Utf8JsonWriter json, Exception? exception)
    {
        if (exception is null)
        {
            return;
        }

        json.WriteStartObject("err");
        json.WriteString("type", exception.GetType().FullName);
        json.WriteString("message", exception.Message);
        json.WriteString("stack", exception.StackTrace);
        json.WriteEndObject();
    }

    private static void WriteValue(Utf8JsonWriter json, LogEventPropertyValue value)
    {
        switch (value)
        {
            case ScalarValue { Value: null }:
                json.WriteNullValue();
                break;
            case ScalarValue { Value: bool flag }:
                json.WriteBooleanValue(flag);
                break;
            case ScalarValue { Value: int or long or short or byte or uint or ulong or ushort or sbyte } scalar:
                json.WriteNumberValue(Convert.ToInt64(scalar.Value, CultureInfo.InvariantCulture));
                break;
            case ScalarValue { Value: double or float or decimal } scalar:
                json.WriteNumberValue(Convert.ToDouble(scalar.Value, CultureInfo.InvariantCulture));
                break;
            case ScalarValue scalar:
                json.WriteStringValue(Convert.ToString(scalar.Value, CultureInfo.InvariantCulture));
                break;
            case SequenceValue sequence:
                json.WriteStartArray();
                foreach (var element in sequence.Elements)
                {
                    WriteValue(json, element);
                }

                json.WriteEndArray();
                break;
            case StructureValue structure:
                json.WriteStartObject();
                foreach (var property in structure.Properties)
                {
                    json.WritePropertyName(CamelCase(property.Name));
                    WriteValue(json, property.Value);
                }

                json.WriteEndObject();
                break;
            case DictionaryValue dictionary:
                json.WriteStartObject();
                foreach (var (key, element) in dictionary.Elements)
                {
                    json.WritePropertyName(Convert.ToString(key.Value, CultureInfo.InvariantCulture) ?? "");
                    WriteValue(json, element);
                }

                json.WriteEndObject();
                break;
        }
    }

    private static string CamelCase(string name) =>
        name.Length == 0 || char.IsLower(name[0]) ? name : char.ToLowerInvariant(name[0]) + name[1..];
}
