using System.Net;

using Elysion.BusinessBackend.Api.Webhooks;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>
/// The sender of the worker on a real socket (ADR 0033): the address is checked where the connection is made (not only when the URL
/// was registered), a redirect is not followed, and the request is signed.
/// </summary>
public class WebhookSenderTests
{
    private const string Secret = "whsec_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

    private LocalReceiver _receiver = null!;

    [SetUp]
    public void SetUp() => _receiver = new LocalReceiver();

    [TearDown]
    public void TearDown() => _receiver.Dispose();

    /// <summary>Gives every name the loopback address, as a DNS answer an attacker controls would.</summary>
    private sealed class LoopbackResolver : IWebhookHostResolver
    {
        public int Calls { get; private set; }

        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new[] { IPAddress.Loopback });
        }
    }

    private static WebhookSender Sender(WebhookOptions options, IWebhookHostResolver resolver) =>
        new(new HttpClient(WebhookHttpHandler.Create(options, resolver)), TimeProvider.System);

    private WebhookMessage Message(string host) =>
        new($"http://{host}:{_receiver.Port}/hook",
            Secret,
            Guid.NewGuid(),
            Guid.NewGuid(),
            "board.renamed",
            "{\"type\":\"board.renamed\"}");

    [Test]
    public async Task A_name_that_resolves_to_a_loopback_address_is_refused_when_the_connection_is_made()
    {
        var resolver = new LoopbackResolver();
        var sender = Sender(new WebhookOptions { AllowHttp = true }, resolver);

        var attempt = await sender.SendAsync(Message("hooks.example.com"), CancellationToken.None);

        attempt.Succeeded.ShouldBeFalse();
        attempt.ResponseStatus.ShouldBeNull();
        attempt.Error.ShouldBe("Refused: the host resolves to no public address.");
        resolver.Calls.ShouldBe(1);
        _receiver.Requests.ShouldBeEmpty();
    }

    [Test]
    public async Task An_address_literal_of_a_private_range_is_refused_without_a_lookup()
    {
        var resolver = new LoopbackResolver();
        var sender = Sender(new WebhookOptions { AllowHttp = true }, resolver);

        var attempt = await sender.SendAsync(Message("127.0.0.1"), CancellationToken.None);

        attempt.Error.ShouldBe("Refused: the host resolves to no public address.");
        resolver.Calls.ShouldBe(0);
        _receiver.Requests.ShouldBeEmpty();
    }

    [Test]
    public async Task The_connection_goes_to_the_address_that_was_checked()
    {
        var addresses = await WebhookHttpHandler.AllowedAddressesAsync("hooks.example.com",
            new WebhookOptions(),
            new MixedResolver(),
            CancellationToken.None);

        addresses.ShouldBe([IPAddress.Parse("93.184.215.14")]);
    }

    /// <summary>A name with a public and a private address: only the public one may be used.</summary>
    private sealed class MixedResolver : IWebhookHostResolver
    {
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
            Task.FromResult(new[]
            {
                IPAddress.Parse("10.0.0.7"), IPAddress.Parse("93.184.215.14"), IPAddress.Parse("::ffff:127.0.0.1")
            });
    }

    [Test]
    public async Task With_private_networks_allowed_a_local_receiver_gets_a_signed_post()
    {
        var sender = Sender(new WebhookOptions { AllowHttp = true, AllowPrivateNetworks = true },
            new LoopbackResolver());
        var message = Message("127.0.0.1");

        var attempt = await sender.SendAsync(message, CancellationToken.None);

        attempt.Succeeded.ShouldBeTrue();
        attempt.ResponseStatus.ShouldBe(200);
        var request = _receiver.Requests.ShouldHaveSingleItem();
        request.Method.ShouldBe("POST");
        request.Body.ShouldBe(message.Payload);
        request.Headers["Content-Type"].ShouldStartWith("application/json");
        request.Headers["Elysion-Event"].ShouldBe("board.renamed");
        request.Headers["Elysion-Event-Id"].ShouldBe(message.EventId.ToString());
        request.Headers["Elysion-Delivery"].ShouldBe(message.DeliveryId.ToString());
        WebhookSecrets.Verify(Secret,
                request.Headers["Elysion-Signature"],
                request.Body,
                DateTimeOffset.UtcNow,
                TimeSpan.FromMinutes(5))
            .ShouldBeTrue();
    }

    [Test]
    public async Task A_redirect_is_not_followed_and_counts_as_a_failure()
    {
        _receiver.Status = 302;
        _receiver.Location = _receiver.Url("/elsewhere");
        var sender = Sender(new WebhookOptions { AllowHttp = true, AllowPrivateNetworks = true },
            new LoopbackResolver());

        var attempt = await sender.SendAsync(Message("127.0.0.1"), CancellationToken.None);

        attempt.Succeeded.ShouldBeFalse();
        attempt.ResponseStatus.ShouldBe(302);
        attempt.Error.ShouldBe("HTTP 302: redirects are not followed.");
        _receiver.Requests.ShouldHaveSingleItem().Path.ShouldBe("/hook");
    }

    [Test]
    public async Task An_error_answer_is_a_failure_that_names_the_status_and_not_the_url()
    {
        _receiver.Status = 503;
        var sender = Sender(new WebhookOptions { AllowHttp = true, AllowPrivateNetworks = true },
            new LoopbackResolver());

        var attempt = await sender.SendAsync(Message("127.0.0.1"), CancellationToken.None);

        attempt.Succeeded.ShouldBeFalse();
        attempt.ResponseStatus.ShouldBe(503);
        attempt.Error.ShouldBe("HTTP 503.");
    }
}
