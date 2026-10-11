using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Graph;

/// <summary>
/// The background job of the Graph sync (#667): off unless <see cref="GraphOptions.Enabled"/>, otherwise one run at the start (after a short
/// pause) and then every <see cref="GraphOptions.Interval"/>. A run that throws is logged and the next one tries again. Several
/// instances may run it: every step is idempotent.
/// </summary>
public sealed class GraphSyncService(
    IServiceScopeFactory scopes,
    IOptions<GraphOptions> options,
    TimeProvider time,
    ILogger<GraphSyncService> logger) : BackgroundService
{
    public static readonly TimeSpan StartDelay = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("The Graph group sync is off: {Tenant}, {Client} and {Secret} are not all set.",
                GraphOptions.TenantIdSetting,
                GraphOptions.ClientIdSetting,
                GraphOptions.ClientSecretSetting);
            return;
        }

        logger.LogInformation("The Graph group sync runs every {Interval}.", settings.Interval);
        try
        {
            await Task.Delay(StartDelay, time, stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                await RunOnceAsync(stoppingToken);
                await Task.Delay(settings.Interval, time, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // shutting down
        }
    }

    /// <summary>One run in its own scope; an exception is logged, never thrown (the next run tries again).</summary>
    public async Task<GraphSyncRun?> RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var sync = scope.ServiceProvider.GetRequiredService<GraphGroupSync>();
            var run = await sync.RunAsync(cancellationToken);
            logger.LogInformation("Graph group sync: {Groups} groups, {Changed} changed, {Failed} failed.",
                run.Groups,
                run.Changed,
                run.Failed);
            return run;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (GraphException e)
        {
            logger.LogWarning("The Graph group sync could not run: {Reason}", e.Message);
            return null;
        }
        catch (Exception e)
        {
            logger.LogError(e, "The Graph group sync failed; it is tried again at the next interval.");
            return null;
        }
    }
}
