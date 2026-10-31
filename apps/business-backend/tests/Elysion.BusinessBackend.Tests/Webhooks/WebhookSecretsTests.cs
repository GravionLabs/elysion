using Elysion.BusinessBackend.Api.Webhooks;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>The secret of an endpoint and the signature of a delivery (ADR 0033, #853).</summary>
public class WebhookSecretsTests
{
    private const string Secret = "whsec_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
    private const string Body = "{\"type\":\"board.renamed\"}";
    private static readonly DateTimeOffset SentAt = DateTimeOffset.FromUnixTimeSeconds(1700000000);

    [Test]
    public void The_signature_is_the_hex_hmac_sha256_of_the_timestamp_a_dot_and_the_body()
    {
        // printf '%s' '1700000000.{"type":"board.renamed"}' | openssl dgst -sha256 -hmac '<secret>'
        WebhookSecrets.Sign(Secret, 1700000000, Body)
            .ShouldBe("t=1700000000,v1=0447f8e2e0dc806f57bd4a78314b29b6548b98610875fb9142fa0c4fcd12aa05");
    }

    [Test]
    public void A_receiver_accepts_a_fresh_signature_of_the_same_body()
    {
        var header = WebhookSecrets.Sign(Secret, SentAt.ToUnixTimeSeconds(), Body);

        WebhookSecrets.Verify(Secret, header, Body, SentAt.AddMinutes(4), TimeSpan.FromMinutes(5)).ShouldBeTrue();
    }

    [Test]
    public void A_receiver_refuses_a_changed_body_another_secret_an_old_timestamp_and_garbage()
    {
        var header = WebhookSecrets.Sign(Secret, SentAt.ToUnixTimeSeconds(), Body);
        var tolerance = TimeSpan.FromMinutes(5);

        WebhookSecrets.Verify(Secret, header, Body + " ", SentAt, tolerance).ShouldBeFalse();
        WebhookSecrets.Verify(WebhookSecrets.Generate(), header, Body, SentAt, tolerance).ShouldBeFalse();
        WebhookSecrets.Verify(Secret, header, Body, SentAt.AddMinutes(6), tolerance).ShouldBeFalse();
        WebhookSecrets.Verify(Secret, "v1=abc", Body, SentAt, tolerance).ShouldBeFalse();
        WebhookSecrets.Verify(Secret, "", Body, SentAt, tolerance).ShouldBeFalse();
    }

    [Test]
    public void A_new_secret_has_the_prefix_and_is_different_every_time()
    {
        var one = WebhookSecrets.Generate();
        var two = WebhookSecrets.Generate();

        one.ShouldStartWith("whsec_");
        one.Length.ShouldBe(49);
        WebhookSecrets.LooksValid(one).ShouldBeTrue();
        one.ShouldNotBe(two);
        WebhookSecrets.DisplayPrefix(one).ShouldBe(one[..10]);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("elp_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHI")]
    [TestCase("whsec_0123456789abcdefghijklmnopqrstuvwxyzABCDE-")]
    [TestCase("whsec_short")]
    public void Anything_else_is_not_a_secret(string? text) => WebhookSecrets.LooksValid(text).ShouldBeFalse();
}
