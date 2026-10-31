using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>
/// Which changes put which events into the outbox (ADR 0033, #853), and what a payload carries: event id, type, time, board, actor
/// and what changed, never the board's content.
/// </summary>
public class WebhookEventTests : WebhookTestBase
{
    private static JsonElement PayloadOf(Api.Entities.WebhookDelivery delivery) =>
        JsonDocument.Parse(delivery.Payload).RootElement.Clone();

    [Test]
    public async Task A_rename_is_a_board_renamed_with_the_new_and_the_old_name_and_the_person_who_did_it()
    {
        await RegisterAsync();
        using var owner = As("owner");

        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Retro 2" }))).EnsureSuccessStatusCode();

        var delivery = (await Deliveries()).ShouldHaveSingleItem();
        delivery.EventType.ShouldBe("board.renamed");
        delivery.Status.ShouldBe(Api.Entities.WebhookDeliveryStatus.Pending);
        var payload = PayloadOf(delivery);
        payload.EnumerateObject()
            .Select(p => p.Name)
            .ShouldBe(["id", "type", "occurredAt", "boardId", "actorId", "data"]);
        payload.GetProperty("id").GetGuid().ShouldBe(delivery.EventId);
        payload.GetProperty("type").GetString().ShouldBe("board.renamed");
        payload.GetProperty("occurredAt").GetDateTimeOffset().ShouldBe(Start);
        payload.GetProperty("boardId").GetGuid().ShouldBe(Board.Id);
        payload.GetProperty("actorId").GetGuid().ShouldBe(Users["owner"].Id);
        payload.GetProperty("data").GetProperty("name").GetString().ShouldBe("Retro 2");
        payload.GetProperty("data").GetProperty("previousName").GetString().ShouldBe("Retro");
    }

    [Test]
    public async Task A_rename_to_the_same_name_and_a_refused_change_put_nothing_in_the_outbox()
    {
        await RegisterAsync();
        using var owner = As("owner");
        using var viewer = As("viewer");

        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Retro" }))).EnsureSuccessStatusCode();
        (await viewer.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Mine" }))).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "" }))).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);

        (await Deliveries()).ShouldBeEmpty();
    }

    [Test]
    public async Task An_endpoint_gets_only_the_events_it_subscribed_to()
    {
        await RegisterAsync(events: ["member.added"]);
        using var owner = As("owner");

        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Retro 2" }))).EnsureSuccessStatusCode();
        (await owner.PostAsync($"/boards/{Board.Id}/members",
            Json(new { userId = Users["stranger"].Id, role = "Viewer" }))).EnsureSuccessStatusCode();

        (await Deliveries()).ShouldHaveSingleItem().EventType.ShouldBe("member.added");
    }

    [Test]
    public async Task Adding_changing_and_removing_a_member_are_three_events_with_the_person_and_the_roles()
    {
        await RegisterAsync();
        using var owner = As("owner");
        var stranger = Users["stranger"].Id;

        (await owner.PostAsync($"/boards/{Board.Id}/members", Json(new { userId = stranger, role = "Viewer" })))
            .EnsureSuccessStatusCode();
        (await owner.PatchAsync($"/boards/{Board.Id}/members/{stranger}",
                Json(new { role = "Editor", expiresInHours = 24 })))
            .EnsureSuccessStatusCode();
        (await owner.DeleteAsync($"/boards/{Board.Id}/members/{stranger}")).EnsureSuccessStatusCode();

        var payloads = (await Deliveries()).Select(PayloadOf).ToDictionary(p => p.GetProperty("type").GetString()!);
        payloads.Keys.ShouldBe(["member.added", "member.role_changed", "member.removed"], ignoreOrder: true);
        payloads["member.added"].GetProperty("data").GetProperty("userId").GetGuid().ShouldBe(stranger);
        payloads["member.added"].GetProperty("data").GetProperty("role").GetString().ShouldBe("Viewer");
        payloads["member.role_changed"].GetProperty("data").GetProperty("previousRole").GetString().ShouldBe("Viewer");
        payloads["member.role_changed"].GetProperty("data").GetProperty("role").GetString().ShouldBe("Editor");
        payloads["member.removed"].GetProperty("data").GetProperty("role").GetString().ShouldBe("Editor");
        payloads.Values.ShouldAllBe(p => p.GetProperty("actorId").GetGuid() == Users["owner"].Id);
    }

    [Test]
    public async Task Joining_by_an_invitation_link_is_a_member_added_by_the_person_who_joined()
    {
        await RegisterAsync();
        using var owner = As("owner");
        var invitation = await (await owner.PostAsync($"/boards/{Board.Id}/invitations",
                Json(new { role = "Editor", expiresInHours = 24 })))
            .Content.ReadFromJsonAsync<JsonElement>(Web);
        using var stranger = As("stranger");

        (await stranger.PostAsync($"/invitations/{invitation.GetProperty("token").GetString()}/accept", null))
            .EnsureSuccessStatusCode();

        var payload = PayloadOf((await Deliveries()).ShouldHaveSingleItem());
        payload.GetProperty("type").GetString().ShouldBe("member.added");
        payload.GetProperty("actorId").GetGuid().ShouldBe(Users["stranger"].Id);
        payload.GetProperty("data").GetProperty("role").GetString().ShouldBe("Editor");
    }

    [Test]
    public async Task Content_changes_are_sent_at_most_once_a_minute_per_board_and_never_carry_the_content()
    {
        await RegisterAsync();
        byte[] state = [0x01, 0x02, 0x7a, 0x7a];

        await SaveDocumentAsync(null, state);
        Time.Advance(TimeSpan.FromSeconds(10));
        await SaveDocumentAsync(1, [0x01, 0x03]);
        Time.Advance(TimeSpan.FromSeconds(49));
        await SaveDocumentAsync(2, [0x01, 0x04]);
        Time.Advance(TimeSpan.FromSeconds(1)); // a minute after the first
        await SaveDocumentAsync(3, [0x01, 0x05]);

        var changes = (await Deliveries()).Where(d => d.EventType == "board.content.changed").ToList();
        changes.Count.ShouldBe(2);
        var payload = PayloadOf(changes.Single(d => d.CreatedAt == Start));
        payload.GetProperty("actorId").ValueKind.ShouldBe(JsonValueKind.Null);
        payload.GetProperty("data").GetProperty("version").GetInt64().ShouldBe(1);
        PayloadOf(changes.Single(d => d.CreatedAt > Start))
            .GetProperty("data")
            .GetProperty("version")
            .GetInt64()
            .ShouldBe(4);
        changes.ShouldAllBe(d => !d.Payload.Contains("AQJ6eg") && !d.Payload.Contains("state"));
    }

    [Test]
    public async Task A_compaction_rebuild_is_not_a_content_change()
    {
        await SaveDocumentAsync(null, [0x01]);
        await RegisterAsync();
        Time.Advance(TimeSpan.FromMinutes(5));

        await SaveDocumentAsync(1, [0x02], reason: "compaction");

        (await Deliveries()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_saved_version_is_a_snapshot_created_and_an_automatic_one_is_not()
    {
        await SaveDocumentAsync(null, [0x01]);
        await RegisterAsync(events: ["snapshot.created"]);
        await SaveDocumentAsync(1, [0x02]); // keeps the previous state as an automatic version
        Factory.Files.Keys.ShouldContain(k => k.StartsWith($"snapshots/{Board.Id}/", StringComparison.Ordinal));
        (await Deliveries()).ShouldBeEmpty();

        using var owner = As("owner");
        var created =
            await owner.PostAsync($"/boards/{Board.Id}/snapshots", Json(new { name = "Before the workshop" }));
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        var snapshot = await created.Content.ReadFromJsonAsync<JsonElement>(Web);

        var payload = PayloadOf((await Deliveries()).ShouldHaveSingleItem());
        payload.GetProperty("type").GetString().ShouldBe("snapshot.created");
        payload.GetProperty("data").GetProperty("snapshotId").GetGuid().ShouldBe(snapshot.GetProperty("id").GetGuid());
        payload.GetProperty("data").GetProperty("name").GetString().ShouldBe("Before the workshop");
    }

    [Test]
    public async Task A_deleted_board_tells_its_own_endpoints_which_go_once_that_was_delivered()
    {
        var id = (await RegisterAsync()).GetProperty("id").GetGuid();
        using var owner = As("owner");

        (await owner.DeleteAsync($"/boards/{Board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var delivery = (await Deliveries()).ShouldHaveSingleItem();
        delivery.EventType.ShouldBe("board.deleted");
        PayloadOf(delivery).GetProperty("data").GetProperty("name").GetString().ShouldBe("Retro");
        var worker = Factory.Services.GetService(typeof(Api.Webhooks.WebhookDeliveryService))
            as Api.Webhooks.WebhookDeliveryService;
        (await worker!.RemoveOrphansAsync(Ct)).ShouldBe(0); // still to be sent
        await RunWorkerAsync();
        Factory.WebhookSender.Sent.ShouldHaveSingleItem().EventType.ShouldBe("board.deleted");
        (await worker.RemoveOrphansAsync(Ct)).ShouldBe(1);
        (await Query(db => Task.FromResult(db.WebhookEndpoints.Any(e => e.Id == id)))).ShouldBeFalse();
    }

    [Test]
    public async Task A_duplicate_is_a_board_created_for_the_instance_wide_endpoints()
    {
        await RegisterAsync("https://all.example.com", path: "/admin/webhooks");
        using var owner = As("owner");

        var copy = await (await owner.PostAsync($"/boards/{Board.Id}/duplicate", null))
            .Content.ReadFromJsonAsync<JsonElement>(Web);

        var payload = PayloadOf((await Deliveries()).ShouldHaveSingleItem());
        payload.GetProperty("type").GetString().ShouldBe("board.created");
        payload.GetProperty("boardId").GetGuid().ShouldBe(copy.GetProperty("id").GetGuid());
        payload.GetProperty("data").GetProperty("duplicatedFrom").GetGuid().ShouldBe(Board.Id);
    }
}
