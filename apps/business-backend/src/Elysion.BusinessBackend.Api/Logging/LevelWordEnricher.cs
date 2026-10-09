using Serilog.Core;
using Serilog.Events;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// Adds <c>level</c> (<c>trace</c> to <c>fatal</c>, the words of all three services) to an event. The OpenTelemetry sink
/// writes Serilog's own names (<c>Warning</c>) as the severity text, so a query for <c>level:warn</c> would miss the
/// backend; this property is what the viewer can search across components (ADR 0025).
/// </summary>
public sealed class LevelWordEnricher : ILogEventEnricher
{
    public const string PropertyName = "level";

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        ArgumentNullException.ThrowIfNull(logEvent);
        ArgumentNullException.ThrowIfNull(propertyFactory);
        logEvent.AddPropertyIfAbsent(
            propertyFactory.CreateProperty(PropertyName, ElysionJsonFormatter.LevelName(logEvent.Level)));
    }
}
