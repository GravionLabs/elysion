using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

using Prometheus;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// The worker of the outbox (ADR 0033, #853): every <see cref="WebhookOptions.PollInterval"/> it takes the due deliveries, posts
/// them (<see cref="IWebhookSender"/>, 10 s timeout, signed) and writes how it went. A failure is tried again after an exponential
/// backoff (<see cref="Backoff"/>) for <see cref="RetryWindow"/>; an endpoint where nothing has succeeded for
/// <see cref="DisableAfter"/> is switched off, with the reason for its owners. Every instance of the backend runs it: a delivery is
/// taken with a lease (<see cref="IWebhookRepository.TryLeaseAsync"/>), so two instances never send the same row at the same time,
/// and a row whose instance died is taken again when the lease ends.
/// </summary>
public sealed partial class WebhookDeliveryService(
    IServiceScopeFactory scopes,
    IOptions<WebhookOptions> options,
    TimeProvider time,
    ILogger<WebhookDeliveryService> logger) : BackgroundService
{
    /// <summary>How many finished deliveries an endpoint keeps for its owners.</summary>
    public const int KeptPerEndpoint = 50;

    /// <summary>How long a delivery is retried.</summary>
    public static readonly TimeSpan RetryWindow = TimeSpan.FromHours(24);

    /// <summary>How long an endpoint may fail before it is switched off.</summary>
    public static readonly TimeSpan DisableAfter = TimeSpan.FromHours(24);

    /// <summary>How long an instance holds a row it sends: well over the timeout.</summary>
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    public const int BatchSize = 20;

    private static readonly TimeSpan FirstRetry = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan LongestRetry = TimeSpan.FromHours(1);
    private static readonly TimeSpan OrphanInterval = TimeSpan.FromMinutes(10);

    private static readonly Gauge Pending = Prometheus.Metrics.CreateGauge(
        "elysion_webhook_outbox_pending",
        "Webhook deliveries waiting to be sent (the outbox).");

    private static readonly Counter Attempts = Prometheus.Metrics.CreateCounter(
        "elysion_webhook_delivery_attempts_total",
        "Attempts to deliver a webhook, by outcome (succeeded, retry, failed).",
        new CounterConfiguration { LabelNames = ["outcome"] });

    private DateTimeOffset _orphansCheckedAt = DateTimeOffset.MinValue;

    /// <summary>The wait after the <paramref name="attempts"/>th failed attempt: 30 s, doubling, at most an hour.</summary>
    public static TimeSpan Backoff(int attempts)
    {
        var exponent = Math.Clamp(attempts - 1, 0, 20);
        var wait = FirstRetry * Math.Pow(2, exponent);
        return wait < LongestRetry ? wait : LongestRetry;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.WorkerEnabled)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
                if (time.GetUtcNow() - _orphansCheckedAt >= OrphanInterval)
                {
                    _orphansCheckedAt = time.GetUtcNow();
                    await RemoveOrphansAsync(stoppingToken);
                }

                await Task.Delay(options.Value.PollInterval, time, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                PassFailed(logger, exception);
                try
                {
                    await Task.Delay(options.Value.PollInterval, time, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    /// <summary>One pass: sends what is due (at most <see cref="BatchSize"/>), writes the outcomes; returns how many were sent.</summary>
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var webhooks = scope.ServiceProvider.GetRequiredService<IWebhookRepository>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        var sender = scope.ServiceProvider.GetRequiredService<IWebhookSender>();

        var now = time.GetUtcNow();
        var taken = new List<WebhookDelivery>();
        foreach (var delivery in await webhooks.ListDueAsync(now, BatchSize, cancellationToken))
        {
            if (await webhooks.TryLeaseAsync(delivery, now + Lease, cancellationToken))
            {
                taken.Add(delivery);
            }
        }

        if (taken.Count > 0)
        {
            var attempts = await Task.WhenAll(taken.Select(delivery => sender.SendAsync(
                new WebhookMessage(delivery.Endpoint!.Url,
                    delivery.Endpoint.Secret,
                    delivery.Id,
                    delivery.EventId,
                    delivery.EventType,
                    delivery.Payload),
                cancellationToken)));
            var disabled = new List<WebhookEndpoint>();
            for (var i = 0; i < taken.Count; i++)
            {
                Record(taken[i], attempts[i], time.GetUtcNow(), disabled);
            }

            try
            {
                await unitOfWork.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                // The endpoint was deleted meanwhile (its deliveries went with it), or its row was changed: nothing to keep.
                unitOfWork.DiscardChanges();
            }

            foreach (var endpoint in disabled.DistinctBy(e => e.Id))
            {
                await FailPendingAsync(webhooks, unitOfWork, endpoint, cancellationToken);
            }

            foreach (var endpointId in taken.Select(d => d.EndpointId).Distinct())
            {
                await webhooks.TrimAsync(endpointId, KeptPerEndpoint, cancellationToken);
            }
        }

        Pending.Set(await webhooks.CountPendingAsync(cancellationToken));
        return taken.Count;
    }

    /// <summary>Removes the endpoints of deleted boards once their last delivery (the <c>board.deleted</c>) is done.</summary>
    public async Task<int> RemoveOrphansAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<IWebhookRepository>()
            .RemoveOrphansAsync(cancellationToken);
    }

    private void Record(WebhookDelivery delivery,
        WebhookAttempt attempt,
        DateTimeOffset now,
        List<WebhookEndpoint> disabled)
    {
        var endpoint = delivery.Endpoint!;
        delivery.Attempts++;
        delivery.LastAttemptAt = now;
        delivery.ResponseStatus = attempt.ResponseStatus;
        delivery.DurationMs = attempt.DurationMs;
        delivery.Error = attempt.Error is { Length: > WebhookDelivery.MaxErrorLength }
            ? attempt.Error[..WebhookDelivery.MaxErrorLength]
            : attempt.Error;
        delivery.LeaseUntil = null;

        if (attempt.Succeeded)
        {
            delivery.Status = WebhookDeliveryStatus.Succeeded;
            endpoint.FailingSince = null;
            Attempts.WithLabels("succeeded").Inc();
            return;
        }

        endpoint.FailingSince ??= now;
        AttemptFailed(logger,
            endpoint.Id,
            WebhookUrl.HostOf(endpoint.Url),
            delivery.EventType,
            delivery.Attempts,
            attempt.Error ?? "");
        if (now - endpoint.FailingSince.Value >= DisableAfter)
        {
            delivery.Status = WebhookDeliveryStatus.Failed;
            endpoint.DisabledAt = now;
            var reason =
                $"Switched off on {now:yyyy-MM-dd HH:mm} UTC: no delivery succeeded for 24 hours. The last attempt: {attempt.Error}";
            endpoint.DisabledReason = reason.Length > WebhookEndpoint.MaxReasonLength
                ? reason[..WebhookEndpoint.MaxReasonLength]
                : reason;
            disabled.Add(endpoint);
            Attempts.WithLabels("failed").Inc();
            EndpointDisabled(logger, endpoint.Id, WebhookUrl.HostOf(endpoint.Url));
        }
        else if (now - delivery.CreatedAt >= RetryWindow)
        {
            delivery.Status = WebhookDeliveryStatus.Failed;
            Attempts.WithLabels("failed").Inc();
        }
        else
        {
            delivery.NextAttemptAt = now + Backoff(delivery.Attempts);
            Attempts.WithLabels("retry").Inc();
        }
    }

    /// <summary>An endpoint that was switched off sends nothing more: what still waits for it has failed.</summary>
    private static async Task FailPendingAsync(IWebhookRepository webhooks,
        IUnitOfWork unitOfWork,
        WebhookEndpoint endpoint,
        CancellationToken cancellationToken)
    {
        var pending = await webhooks.ListPendingForUpdateAsync(endpoint.Id, cancellationToken);
        foreach (var delivery in pending)
        {
            delivery.GiveUpSwitchedOff();
        }

        if (pending.Count > 0)
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message =
            "Webhook {WebhookId} to {Host}: {EventType} failed (attempt {Attempt}): {Error}")]
    private static partial void AttemptFailed(ILogger logger,
        Guid webhookId,
        string host,
        string eventType,
        int attempt,
        string error);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Webhook {WebhookId} to {Host} was switched off: nothing succeeded for 24 hours.")]
    private static partial void EndpointDisabled(ILogger logger, Guid webhookId, string host);

    [LoggerMessage(Level = LogLevel.Error, Message = "A pass of the webhook worker failed; it tries again.")]
    private static partial void PassFailed(ILogger logger, Exception exception);
}
