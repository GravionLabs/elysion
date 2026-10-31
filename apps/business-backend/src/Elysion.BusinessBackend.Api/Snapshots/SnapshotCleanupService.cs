using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Files;

namespace Elysion.BusinessBackend.Api.Snapshots;

/// <summary>
/// Once a night (ADR 0032): removes the automatic snapshots older than <see cref="BoardSnapshotService.AutomaticRetention"/> and the
/// objects of <c>snapshots/</c> that have no row (a crash between writing the object and the row, or a board deleted while a
/// snapshot was being made). Every instance may run it; both steps are idempotent.
/// </summary>
public sealed partial class SnapshotCleanupService(
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<SnapshotCleanupService> logger) : BackgroundService
{
    /// <summary>Night, UTC, a little after the audit cleanup.</summary>
    private static readonly TimeSpan RunAt = new(3, 41, 0);

    private const int BatchSize = 500;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(UntilNextRun(time.GetUtcNow()), time, stoppingToken);
                await ExpireAsync(stoppingToken);
                await RemoveOrphansAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                Failed(logger, exception);
            }
        }
    }

    /// <summary>The time from <paramref name="now"/> to the next run.</summary>
    public static TimeSpan UntilNextRun(DateTimeOffset now)
    {
        var next = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero) + RunAt;
        return next > now ? next - now : next.AddDays(1) - now;
    }

    /// <summary>Removes the expired automatic snapshots; returns how many went.</summary>
    public async Task<int> ExpireAsync(CancellationToken cancellationToken)
    {
        var cutoff = time.GetUtcNow() - BoardSnapshotService.AutomaticRetention;
        var total = 0;
        while (true)
        {
            using var scope = scopes.CreateScope();
            var snapshots = scope.ServiceProvider.GetRequiredService<IBoardSnapshotRepository>();
            var service = scope.ServiceProvider.GetRequiredService<BoardSnapshotService>();
            var batch = await snapshots.AutomaticOlderThanAsync(cutoff, BatchSize, cancellationToken);
            if (batch.Count == 0)
            {
                break;
            }

            await service.RemoveAsync(batch, cancellationToken);
            total += batch.Count;
        }

        if (total > 0)
        {
            Expired(logger, total);
        }

        return total;
    }

    /// <summary>Removes objects of <c>snapshots/</c> without a row; returns how many went.</summary>
    public async Task<int> RemoveOrphansAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IFileStore>();
        var snapshots = scope.ServiceProvider.GetRequiredService<IBoardSnapshotRepository>();
        var removed = 0;
        var byBoard = (await store.ListAsync("snapshots/", cancellationToken))
            .Select(key => (Key: key, Parts: key.Split('/')))
            .Where(item => item.Parts.Length == 3 && Guid.TryParse(item.Parts[1], out _))
            .GroupBy(item => Guid.Parse(item.Parts[1]));
        foreach (var board in byBoard)
        {
            var known = await snapshots.IdsAsync(board.Key, cancellationToken);
            foreach (var (key, parts) in board)
            {
                var name = parts[2];
                var isKnown = name.EndsWith(".yjs.gz", StringComparison.Ordinal)
                              && Guid.TryParse(name[..^".yjs.gz".Length], out var id)
                              && known.Contains(id);
                if (isKnown)
                    continue;
                await store.DeleteAsync(key, cancellationToken);
                removed++;
            }
        }

        if (removed > 0)
        {
            Orphans(logger, removed);
        }

        return removed;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Removed {Count} expired automatic snapshots.")]
    private static partial void Expired(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Information, Message = "Removed {Count} snapshot objects without a row.")]
    private static partial void Orphans(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "The cleanup of the snapshots failed; it is tried again tomorrow.")]
    private static partial void Failed(ILogger logger, Exception exception);
}
