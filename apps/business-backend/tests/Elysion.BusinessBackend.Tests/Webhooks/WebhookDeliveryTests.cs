using System.Net.Http.Json;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Webhooks;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>
/// The worker of the outbox (ADR 0033, #853): retries with an exponential backoff for a day, switches an endpoint off after a day of
/// failures (and says why), keeps the last 50 deliveries.
/// </summary>
public class WebhookDeliveryTests : WebhookTestBase
{
    private Guid _webhook;

    [SetUp]
    public async Task SetUpWebhook() => _webhook = (await RegisterAsync()).GetProperty("id").GetGuid();

    private async Task<WebhookDelivery> StageTestAsync()
    {
        using var owner = As("owner");
        var response = await owner.PostAsync($"/boards/{Board.Id}/webhooks/{_webhook}/test", null);
        var id = (await response.Content.ReadFromJsonAsync<JsonElement>(Web)).GetProperty("id").GetGuid();
        return await Query(db => db.WebhookDeliveries.AsNoTracking().SingleAsync(d => d.Id == id));
    }

    private Task<WebhookDelivery> Reload(Guid id) =>
        Query(db => db.WebhookDeliveries.AsNoTracking().SingleAsync(d => d.Id == id));

    private Task<WebhookEndpoint> Endpoint() =>
        Query(db => db.WebhookEndpoints.AsNoTracking().SingleAsync(e => e.Id == _webhook));

    private void ReceiverFails() =>
        Factory.WebhookSender.Answer = _ => new WebhookAttempt(false, 500, 40, "HTTP 500.");

    [TestCase(1, 30)]
    [TestCase(2, 60)]
    [TestCase(3, 120)]
    [TestCase(7, 1920)]
    [TestCase(8, 3600)] // at most an hour
    [TestCase(30, 3600)]
    public void The_wait_doubles_from_thirty_seconds_up_to_an_hour(int attempts, int seconds) =>
        WebhookDeliveryService.Backoff(attempts).ShouldBe(TimeSpan.FromSeconds(seconds));

    [Test]
    public async Task A_failed_attempt_is_tried_again_after_the_backoff_and_not_before()
    {
        ReceiverFails();
        var delivery = await StageTestAsync();

        (await RunWorkerAsync()).ShouldBe(1);
        var after = await Reload(delivery.Id);
        after.Status.ShouldBe(WebhookDeliveryStatus.Pending);
        after.Attempts.ShouldBe(1);
        after.ResponseStatus.ShouldBe(500);
        after.DurationMs.ShouldBe(40);
        after.Error.ShouldBe("HTTP 500.");
        after.NextAttemptAt.ShouldBe(Start.AddSeconds(30));
        after.LeaseUntil.ShouldBeNull();

        Time.Advance(TimeSpan.FromSeconds(29));
        (await RunWorkerAsync()).ShouldBe(0);
        Time.Advance(TimeSpan.FromSeconds(1));
        (await RunWorkerAsync()).ShouldBe(1);
        (await Reload(delivery.Id)).NextAttemptAt.ShouldBe(Start.AddSeconds(30 + 60));
        (await Endpoint()).FailingSince.ShouldBe(Start);
    }

    [Test]
    public async Task A_success_after_failures_ends_the_failing_period()
    {
        ReceiverFails();
        var delivery = await StageTestAsync();
        await RunWorkerAsync();
        Factory.WebhookSender.Answer = _ => new WebhookAttempt(true, 204, 5, null);
        Time.Advance(TimeSpan.FromSeconds(30));

        await RunWorkerAsync();

        var after = await Reload(delivery.Id);
        after.Status.ShouldBe(WebhookDeliveryStatus.Succeeded);
        after.Attempts.ShouldBe(2);
        after.Error.ShouldBeNull();
        (await Endpoint()).FailingSince.ShouldBeNull();
    }

    [Test]
    public async Task After_a_day_of_failures_the_delivery_fails_and_the_endpoint_is_switched_off_with_the_reason()
    {
        ReceiverFails();
        var first = await StageTestAsync();
        var attempts = 0;
        while ((await Reload(first.Id)).Status == WebhookDeliveryStatus.Pending)
        {
            Time.Advance(TimeSpan.FromSeconds(1) + ((await Reload(first.Id)).NextAttemptAt - Time.GetUtcNow()));
            await RunWorkerAsync();
            attempts++;
            attempts.ShouldBeLessThan(100);
        }

        var failed = await Reload(first.Id);
        failed.Status.ShouldBe(WebhookDeliveryStatus.Failed);
        (failed.LastAttemptAt!.Value - failed.CreatedAt).ShouldBeGreaterThanOrEqualTo(TimeSpan.FromHours(24));
        (failed.LastAttemptAt!.Value - failed.CreatedAt).ShouldBeLessThan(TimeSpan.FromHours(26));
        var endpoint = await Endpoint();
        endpoint.DisabledAt.ShouldNotBeNull();
        endpoint.DisabledReason.ShouldNotBeNull().ShouldContain("no delivery succeeded for 24 hours");
        endpoint.DisabledReason.ShouldContain("HTTP 500.");

        using var owner = As("owner");
        var shown = await owner.GetFromJsonAsync<JsonElement>($"/boards/{Board.Id}/webhooks/{_webhook}", Web);
        shown.GetProperty("enabled").GetBoolean().ShouldBeFalse();
        shown.GetProperty("disabledReason").GetString().ShouldBe(endpoint.DisabledReason);

        // Switched off: nothing new is staged for it, and the worker does not send what was staged before.
        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Unheard" }))).EnsureSuccessStatusCode();
        (await Deliveries()).Count(d => d.EventType == "board.renamed").ShouldBe(0);
    }

    [Test]
    public async Task Switching_off_fails_what_still_waits_for_the_endpoint()
    {
        ReceiverFails();
        var first = await StageTestAsync();
        await RunWorkerAsync();
        Time.Advance(TimeSpan.FromHours(23));
        var second = await StageTestAsync();
        await InDb(async db =>
        {
            // The second one is not due yet when the endpoint is switched off.
            var row = await db.WebhookDeliveries.SingleAsync(d => d.Id == second.Id);
            row.NextAttemptAt = Time.GetUtcNow().AddHours(5);
        });
        Time.Advance(TimeSpan.FromHours(1));

        await RunWorkerAsync();

        (await Reload(first.Id)).Status.ShouldBe(WebhookDeliveryStatus.Failed);
        var waiting = await Reload(second.Id);
        waiting.Status.ShouldBe(WebhookDeliveryStatus.Failed);
        waiting.Error.ShouldBe("Not sent: the endpoint was switched off.");
    }

    [Test]
    public async Task An_endpoint_keeps_its_last_fifty_deliveries()
    {
        var ids = new List<Guid>();
        for (var i = 0; i < 55; i++)
        {
            ids.Add((await StageTestAsync()).Id);
            Time.Advance(TimeSpan.FromSeconds(1));
        }

        while (await RunWorkerAsync() > 0)
        {
        }

        Factory.WebhookSender.Sent.Count.ShouldBe(55);
        var kept = await Deliveries();
        kept.Count.ShouldBe(WebhookDeliveryService.KeptPerEndpoint);
        kept.Select(d => d.Id).ShouldBe(ids.Skip(5), ignoreOrder: true);
        using var owner = As("owner");
        (await owner.GetFromJsonAsync<JsonElement[]>($"/boards/{Board.Id}/webhooks/{_webhook}/deliveries"))!
            .Length.ShouldBe(50);
    }

    [Test]
    public async Task A_row_another_instance_holds_is_left_alone_until_its_lease_ends()
    {
        var delivery = await StageTestAsync();
        await InDb(async db =>
        {
            var row = await db.WebhookDeliveries.SingleAsync(d => d.Id == delivery.Id);
            row.LeaseUntil = Time.GetUtcNow() + WebhookDeliveryService.Lease;
            row.LeaseToken = Guid.NewGuid();
        });

        (await RunWorkerAsync()).ShouldBe(0);
        Time.Advance(WebhookDeliveryService.Lease + TimeSpan.FromSeconds(1));
        (await RunWorkerAsync()).ShouldBe(1);
        Factory.WebhookSender.Sent.ShouldHaveSingleItem();
    }

    [Test]
    public async Task The_size_of_the_outbox_is_a_metric()
    {
        ReceiverFails();
        await StageTestAsync();
        await StageTestAsync();
        await RunWorkerAsync();

        using var client = Factory.CreateClient();
        var metrics = await client.GetStringAsync("/metrics");
        metrics.ShouldContain("elysion_webhook_outbox_pending 2");
        metrics.ShouldContain("elysion_webhook_delivery_attempts_total{outcome=\"retry\"}");
    }
}
