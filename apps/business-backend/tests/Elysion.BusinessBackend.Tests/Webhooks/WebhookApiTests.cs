using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>Registering webhooks (ADR 0033, #853): owners for their board, administrators for every board; the secret is shown once.</summary>
public class WebhookApiTests : WebhookTestBase
{
    private static readonly string[] UnknownEvent = ["board.exploded"];
    private static readonly string[] DeletedOnly = ["board.deleted"];

    [Test]
    public async Task An_owner_registers_a_webhook_and_sees_its_secret_only_in_the_answer()
    {
        var created = await RegisterAsync(events: ["board.renamed", "member.added"]);

        var secret = created.GetProperty("secret").GetString()!;
        secret.ShouldStartWith("whsec_");
        created.GetProperty("secretPrefix").GetString().ShouldBe(secret[..10]);
        created.GetProperty("boardId").GetGuid().ShouldBe(Board.Id);
        created.GetProperty("url").GetString().ShouldBe("https://hooks.example.com/elysion");
        created.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        created.GetProperty("events")
            .EnumerateArray()
            .Select(e => e.GetString())
            .ShouldBe(["board.renamed", "member.added"]);

        using var owner = As("owner");
        var listed = await owner.GetStringAsync($"/boards/{Board.Id}/webhooks");
        listed.ShouldNotContain(secret);
        listed.ShouldNotContain("\"secret\"");
        var one = await owner.GetStringAsync($"/boards/{Board.Id}/webhooks/{created.GetProperty("id").GetGuid()}");
        one.ShouldNotContain(secret);
    }

    [Test]
    public async Task Making_and_deleting_a_webhook_is_in_the_audit_log_with_the_host_only()
    {
        var created = await RegisterAsync("https://hooks.example.com/t/abc?token=secret");
        using var owner = As("owner");
        (await owner.DeleteAsync($"/boards/{Board.Id}/webhooks/{created.GetProperty("id").GetGuid()}"))
            .StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var entries = await Query(db =>
            db.AuditEntries.AsNoTracking().Where(e => e.Action.StartsWith("webhook.")).ToListAsync());
        entries.Select(e => e.Action)
            .ShouldBe([AuditActions.WebhookCreated, AuditActions.WebhookDeleted], ignoreOrder: true);
        entries.ShouldAllBe(e => e.SubjectId == Board.Id && e.Details!.Contains("hooks.example.com")
                                                         && !e.Details.Contains("token"));
        (await owner.GetFromJsonAsync<JsonElement[]>($"/boards/{Board.Id}/webhooks"))!.ShouldBeEmpty();
    }

    [TestCase("editor", HttpStatusCode.Forbidden)]
    [TestCase("viewer", HttpStatusCode.Forbidden)]
    [TestCase("stranger", HttpStatusCode.NotFound)]
    public async Task Only_an_owner_of_the_board_manages_its_webhooks(string who, HttpStatusCode expected)
    {
        var created = await RegisterAsync();
        var id = created.GetProperty("id").GetGuid();
        using var client = As(who);

        (await client.GetAsync($"/boards/{Board.Id}/webhooks")).StatusCode.ShouldBe(expected);
        (await client.PostAsync($"/boards/{Board.Id}/webhooks", Json(new { url = "https://a.example.com" })))
            .StatusCode.ShouldBe(expected);
        (await client.DeleteAsync($"/boards/{Board.Id}/webhooks/{id}")).StatusCode.ShouldBe(expected);
        (await client.PostAsync($"/boards/{Board.Id}/webhooks/{id}/test", null)).StatusCode.ShouldBe(expected);
    }

    [Test]
    public async Task A_webhook_of_another_board_is_not_found_there_nor_in_the_admin_area()
    {
        var created = await RegisterAsync();
        var id = created.GetProperty("id").GetGuid();
        var other = Board.Create(Guid.CreateVersion7(), "Other", Start, Users["stranger"].Id);
        await InDb(db =>
        {
            db.AddRange(other, BoardMembership.Create(other.Id, Users["stranger"].Id, BoardRole.Owner, Start));
            return Task.CompletedTask;
        });

        using var stranger = As("stranger");
        (await stranger.GetAsync($"/boards/{other.Id}/webhooks/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.DeleteAsync($"/boards/{other.Id}/webhooks/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.GetAsync($"/boards/{other.Id}/webhooks/{id}/deliveries")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        using var admin = As("admin");
        (await admin.GetAsync($"/admin/webhooks/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [TestCase("http://hooks.example.com/x", "url", "Only https URLs are allowed.")]
    [TestCase("https://169.254.169.254/latest", "url", "public address")]
    [TestCase("https://localhost/x", "url", "public address")]
    [TestCase("not a url", "url", "absolute https URL")]
    public async Task A_url_that_is_not_public_https_is_refused(string url, string field, string message)
    {
        using var owner = As("owner");
        var response = await owner.PostAsync($"/boards/{Board.Id}/webhooks", Json(new { url }));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(Web);
        problem.GetProperty("errors").GetProperty(field)[0].GetString()!.ShouldContain(message);
    }

    [Test]
    public async Task An_unknown_event_is_refused()
    {
        using var owner = As("owner");
        var response = await owner.PostAsync($"/boards/{Board.Id}/webhooks",
            Json(new { url = "https://hooks.example.com", events = UnknownEvent }));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task A_board_has_at_most_ten_webhooks()
    {
        for (var i = 0; i < WebhookEndpoint.MaxPerBoard; i++)
        {
            await RegisterAsync($"https://hooks.example.com/{i}");
        }

        using var owner = As("owner");
        (await owner.PostAsync($"/boards/{Board.Id}/webhooks", Json(new { url = "https://hooks.example.com/11" })))
            .StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task The_admin_area_is_for_administrators_only()
    {
        using var owner = As("owner");
        (await owner.GetAsync("/admin/webhooks")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await owner.PostAsync("/admin/webhooks", Json(new { url = "https://hooks.example.com" })))
            .StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task An_instance_wide_webhook_hears_about_every_board_and_a_board_s_own_only_about_its_board()
    {
        var everything = await RegisterAsync("https://all.example.com", path: "/admin/webhooks");
        everything.GetProperty("boardId").ValueKind.ShouldBe(JsonValueKind.Null);
        var own = await RegisterAsync("https://own.example.com");

        using var stranger = As("stranger");
        var created = await stranger.PostAsync("/boards", Json(new { name = "Elsewhere" }));
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        using var owner = As("owner");
        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Retro 2" }))).EnsureSuccessStatusCode();

        var deliveries = await Deliveries();
        deliveries.Where(d => d.EndpointId == everything.GetProperty("id").GetGuid())
            .Select(d => d.EventType)
            .ShouldBe(["board.created", "board.renamed"], ignoreOrder: true);
        deliveries.Where(d => d.EndpointId == own.GetProperty("id").GetGuid())
            .Select(d => d.EventType)
            .ShouldBe(["board.renamed"]);
        using var admin = As("admin");
        (await admin.GetFromJsonAsync<JsonElement[]>("/admin/webhooks"))!.ShouldHaveSingleItem();
    }

    [Test]
    public async Task Switching_a_webhook_off_and_on_and_changing_its_url_and_events()
    {
        var id = (await RegisterAsync()).GetProperty("id").GetGuid();
        using var owner = As("owner");

        var off = await owner.PatchAsync($"/boards/{Board.Id}/webhooks/{id}", Json(new { enabled = false }));
        var offBody = await off.Content.ReadFromJsonAsync<JsonElement>(Web);
        offBody.GetProperty("enabled").GetBoolean().ShouldBeFalse();
        offBody.GetProperty("disabledReason").GetString().ShouldBe("Switched off by a person.");
        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Unheard" }))).EnsureSuccessStatusCode();
        (await Deliveries()).ShouldBeEmpty();

        var on = await owner.PatchAsync($"/boards/{Board.Id}/webhooks/{id}",
            Json(new { enabled = true, url = "https://other.example.com/x", events = DeletedOnly }));
        var onBody = await on.Content.ReadFromJsonAsync<JsonElement>(Web);
        onBody.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        onBody.GetProperty("disabledReason").ValueKind.ShouldBe(JsonValueKind.Null);
        onBody.GetProperty("url").GetString().ShouldBe("https://other.example.com/x");
        onBody.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ShouldBe(["board.deleted"]);

        (await owner.PatchAsync($"/boards/{Board.Id}/webhooks/{id}", Json(new { url = "http://plain.example.com" })))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Send_test_event_puts_a_webhook_test_in_the_outbox_that_the_worker_sends()
    {
        var created = await RegisterAsync();
        var id = created.GetProperty("id").GetGuid();
        using var owner = As("owner");

        var response = await owner.PostAsync($"/boards/{Board.Id}/webhooks/{id}/test", null);

        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        var delivery = await response.Content.ReadFromJsonAsync<JsonElement>(Web);
        delivery.GetProperty("eventType").GetString().ShouldBe("webhook.test");
        delivery.GetProperty("status").GetString().ShouldBe("pending");

        (await RunWorkerAsync()).ShouldBe(1);
        var sent = Factory.WebhookSender.Sent.ShouldHaveSingleItem();
        sent.Url.ShouldBe("https://hooks.example.com/elysion");
        sent.Secret.ShouldBe(created.GetProperty("secret").GetString());
        using var payload = JsonDocument.Parse(sent.Payload);
        payload.RootElement.GetProperty("type").GetString().ShouldBe("webhook.test");
        payload.RootElement.GetProperty("data").GetProperty("webhookId").GetGuid().ShouldBe(id);

        var listed = await owner.GetFromJsonAsync<JsonElement[]>($"/boards/{Board.Id}/webhooks/{id}/deliveries", Web);
        var only = listed!.ShouldHaveSingleItem();
        only.GetProperty("status").GetString().ShouldBe("succeeded");
        only.GetProperty("responseStatus").GetInt32().ShouldBe(200);
        only.GetProperty("durationMs").GetInt32().ShouldBe(12);
        only.GetProperty("attempts").GetInt32().ShouldBe(1);
        only.TryGetProperty("payload", out _).ShouldBeFalse();
    }

    [Test]
    public async Task Send_again_posts_the_same_event_once_more_and_waits_for_a_pending_one()
    {
        var id = (await RegisterAsync()).GetProperty("id").GetGuid();
        using var owner = As("owner");
        var first = await (await owner.PostAsync($"/boards/{Board.Id}/webhooks/{id}/test", null))
            .Content.ReadFromJsonAsync<JsonElement>(Web);
        var firstId = first.GetProperty("id").GetGuid();

        (await owner.PostAsync($"/boards/{Board.Id}/webhooks/{id}/deliveries/{firstId}/redeliver", null))
            .StatusCode.ShouldBe(HttpStatusCode.Conflict);
        await RunWorkerAsync();

        var again = await owner.PostAsync($"/boards/{Board.Id}/webhooks/{id}/deliveries/{firstId}/redeliver", null);
        again.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        var second = await again.Content.ReadFromJsonAsync<JsonElement>(Web);
        second.GetProperty("id").GetGuid().ShouldNotBe(firstId);
        second.GetProperty("eventId").GetGuid().ShouldBe(first.GetProperty("eventId").GetGuid());
        await RunWorkerAsync();

        Factory.WebhookSender.Sent.Count.ShouldBe(2);
        Factory.WebhookSender.Sent[1].Payload.ShouldBe(Factory.WebhookSender.Sent[0].Payload);
        (await owner.PostAsync($"/boards/{Board.Id}/webhooks/{id}/deliveries/{Guid.NewGuid()}/redeliver", null))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task The_admin_area_registers_tests_and_deletes_an_instance_wide_webhook()
    {
        var id = (await RegisterAsync(path: "/admin/webhooks")).GetProperty("id").GetGuid();
        using var admin = As("admin");

        (await admin.PostAsync($"/admin/webhooks/{id}/test", null)).StatusCode.ShouldBe(HttpStatusCode.Accepted);
        await RunWorkerAsync();
        (await admin.GetFromJsonAsync<JsonElement[]>($"/admin/webhooks/{id}/deliveries"))!.ShouldHaveSingleItem();
        (await admin.DeleteAsync($"/admin/webhooks/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.GetAsync($"/admin/webhooks/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await admin.GetAsync($"/admin/webhooks/{id}/deliveries")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
