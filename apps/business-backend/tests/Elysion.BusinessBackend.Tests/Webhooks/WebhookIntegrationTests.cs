using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>
/// End to end on this machine (#853): a rename reaches a receiver on the loopback address through the real worker and sender, with a
/// signature the receiver can check as docs/webhooks.md tells it to.
/// </summary>
public class WebhookIntegrationTests : WebhookTestBase
{
    private LocalReceiver _receiver = null!;

    protected override bool RealWebhooks => true;

    [SetUp]
    public void SetUpReceiver() => _receiver = new LocalReceiver();

    [TearDown]
    public void TearDownReceiver() => _receiver.Dispose();

    [Test]
    public async Task A_board_rename_reaches_a_local_receiver_with_a_valid_signature()
    {
        var created = await RegisterAsync(_receiver.Url("/elysion?team=7"));
        var secret = created.GetProperty("secret").GetString()!;
        using var owner = As("owner");

        (await owner.PatchAsync($"/boards/{Board.Id}", Json(new { name = "Sprint 12" }))).EnsureSuccessStatusCode();
        (await RunWorkerAsync()).ShouldBe(1);

        var request = _receiver.Requests.ShouldHaveSingleItem();
        request.Method.ShouldBe("POST");
        request.Path.ShouldBe("/elysion?team=7");
        request.Headers["Elysion-Event"].ShouldBe("board.renamed");

        // The check of docs/webhooks.md, written out: HMAC-SHA256 of "<t>.<body>" with the secret, compared as hex.
        var signature = request.Headers["Elysion-Signature"];
        var parts = signature.Split(',').Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => p[1]);
        var expected = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),
            Encoding.UTF8.GetBytes($"{parts["t"]}.{request.Body}")));
        parts["v1"].ShouldBe(expected);
        long.Parse(parts["t"], System.Globalization.CultureInfo.InvariantCulture).ShouldBe(Start.ToUnixTimeSeconds());

        using var payload = JsonDocument.Parse(request.Body);
        payload.RootElement.GetProperty("type").GetString().ShouldBe("board.renamed");
        payload.RootElement.GetProperty("boardId").GetGuid().ShouldBe(Board.Id);
        payload.RootElement.GetProperty("data").GetProperty("name").GetString().ShouldBe("Sprint 12");

        var delivery = (await Deliveries()).ShouldHaveSingleItem();
        delivery.Status.ShouldBe(Api.Entities.WebhookDeliveryStatus.Succeeded);
        delivery.ResponseStatus.ShouldBe(200);
    }
}
