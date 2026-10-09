using System.Globalization;

using Serilog.Events;
using Serilog.Formatting;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// The same fields as <see cref="ElysionJsonFormatter"/>, readable in a terminal (ADR 0025): time, level, the request
/// id and user when there are some, the message, and the exception below it.
/// </summary>
public sealed class ElysionTextFormatter : ITextFormatter
{
    public void Format(LogEvent logEvent, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(logEvent);
        ArgumentNullException.ThrowIfNull(output);

        output.Write(logEvent.Timestamp.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture));
        output.Write(' ');
        output.Write(ElysionJsonFormatter.LevelName(logEvent.Level).ToUpperInvariant().PadRight(5));
        if (logEvent.Properties.TryGetValue(RequestIdMiddleware.PropertyName, out var requestId))
        {
            output.Write(" [");
            output.Write(requestId.ToString("l", CultureInfo.InvariantCulture));
            output.Write(']');
        }

        if (logEvent.Properties.TryGetValue(UserIdLogMiddleware.PropertyName, out var user))
        {
            output.Write(" (");
            output.Write(user.ToString("l", CultureInfo.InvariantCulture));
            output.Write(')');
        }

        output.Write(' ');
        output.Write(ElysionJsonFormatter.RenderMessage(logEvent));
        output.Write('\n');
        if (logEvent.Exception is not null)
        {
            output.Write(logEvent.Exception);
            output.Write('\n');
        }
    }
}
