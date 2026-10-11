using Elysion.BusinessBackend.Api.Data.Repositories;

using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Audit;

/// <summary>
/// Deletes the entries older than <see cref="AuditOptions.RetentionDays"/> once a night (#669). Every instance may run it: the
/// delete is idempotent, so two of them at the same time do no harm.
/// </summary>
public sealed class AuditRetentionService(
    IServiceScopeFactory scopes,
    IOptions<AuditOptions> options,
    TimeProvider time,
    ILogger<AuditRetentionService> logger) : BackgroundService
{
    /// <summary>Night, UTC: when few people work.</summary>
    private static readonly TimeSpan RunAt = new(3, 17, 0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(UntilNextRun(time.GetUtcNow()), time, stoppingToken);
                await PurgeAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "The cleanup of the audit log failed; it is tried again tomorrow.");
            }
        }
    }

    /// <summary>The time from <paramref name="now"/> to the next run.</summary>
    public static TimeSpan UntilNextRun(DateTimeOffset now)
    {
        var next = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero) + RunAt;
        return next > now ? next - now : next.AddDays(1) - now;
    }

    /// <summary>Removes what is past the retention; returns how many entries went.</summary>
    public async Task<int> PurgeAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditRepository>();
        var cutoff = time.GetUtcNow().AddDays(-options.Value.RetentionDays);
        var removed = await audit.DeleteOlderThanAsync(cutoff, cancellationToken);
        if (removed > 0)
        {
            logger.LogInformation("Removed {Removed} audit entries older than {Days} days.",
                removed,
                options.Value.RetentionDays);
        }

        return removed;
    }
}
