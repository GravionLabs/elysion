using Microsoft.EntityFrameworkCore.Diagnostics;

using System.Data.Common;

using Prometheus;

namespace Elysion.BusinessBackend.Api.Observability;

/// <summary>
/// Prometheus metrics of the backend, served at <c>GET /metrics</c> (docs/specs/gateway.md): the process's own, a
/// count and a duration for every HTTP request, and the database commands. The endpoint is read on the compose
/// network (<c>http://business-backend:8080/metrics</c>); nothing routes it at the edge, which only forwards
/// <c>/api</c> to the BFF.
/// </summary>
public static class Metrics
{
    public static IApplicationBuilder UseElysionHttpMetrics(this IApplicationBuilder app)
    {
        // The `endpoint` label is the route pattern, never the URL: no ids, no query strings.
        return app.UseHttpMetrics();
    }

    public static IEndpointRouteBuilder MapElysionMetrics(this IEndpointRouteBuilder routes)
    {
        routes.MapMetrics().AllowAnonymous(); // a scraper carries no token
        return routes;
    }
}

/// <summary>Counts the commands EF Core sends to the database, by outcome.</summary>
public sealed class CommandCountInterceptor : DbCommandInterceptor
{
    private static readonly Counter Commands = Prometheus.Metrics.CreateCounter(
        "elysion_backend_db_commands_total",
        "Database commands sent by EF Core, by outcome.",
        new CounterConfiguration { LabelNames = ["outcome"] });

    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData) =>
        Commands.WithLabels("error").Inc();

    public override Task CommandFailedAsync(DbCommand command,
        CommandErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Commands.WithLabels("error").Inc();
        return Task.CompletedTask;
    }

    public override DbDataReader ReaderExecuted(DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result)
    {
        Commands.WithLabels("ok").Inc();
        return result;
    }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        Commands.WithLabels("ok").Inc();
        return ValueTask.FromResult(result);
    }

    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    {
        Commands.WithLabels("ok").Inc();
        return result;
    }

    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command,
        CommandExecutedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        Commands.WithLabels("ok").Inc();
        return ValueTask.FromResult(result);
    }

    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    {
        Commands.WithLabels("ok").Inc();
        return result;
    }

    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command,
        CommandExecutedEventData eventData,
        object? result,
        CancellationToken cancellationToken = default)
    {
        Commands.WithLabels("ok").Inc();
        return ValueTask.FromResult(result);
    }
}
