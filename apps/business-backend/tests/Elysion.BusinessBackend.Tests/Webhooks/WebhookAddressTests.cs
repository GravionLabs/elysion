using System.Net;

using Elysion.BusinessBackend.Api.Webhooks;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>Where a webhook may go (ADR 0033, SSRF): the address check of the worker and the URL check of the registration.</summary>
public class WebhookAddressTests
{
    [TestCase("93.184.215.14")]
    [TestCase("8.8.8.8")]
    [TestCase("1.1.1.1")]
    [TestCase("2606:4700:4700::1111")]
    [TestCase("2a00:1450:4001:82a::200e")]
    [TestCase("::ffff:8.8.8.8")] // IPv4-mapped public
    [TestCase("64:ff9b::808:808")] // NAT64 of 8.8.8.8
    public void A_public_address_is_allowed(string address) =>
        WebhookAddressPolicy.IsPublic(IPAddress.Parse(address)).ShouldBeTrue();

    [TestCase("127.0.0.1")]
    [TestCase("127.255.255.254")]
    [TestCase("10.0.0.5")]
    [TestCase("172.16.0.1")]
    [TestCase("172.31.255.255")]
    [TestCase("192.168.1.1")]
    [TestCase("169.254.169.254")] // the metadata service of the clouds
    [TestCase("100.64.0.1")]
    [TestCase("0.0.0.0")]
    [TestCase("224.0.0.1")]
    [TestCase("255.255.255.255")]
    [TestCase("198.18.0.1")]
    [TestCase("192.0.2.10")]
    [TestCase("::1")]
    [TestCase("::")]
    [TestCase("fe80::1")]
    [TestCase("fc00::1")]
    [TestCase("fd12:3456:789a::1")]
    [TestCase("ff02::1")]
    [TestCase("2001:db8::1")]
    [TestCase("::ffff:127.0.0.1")] // IPv4-mapped loopback
    [TestCase("::ffff:169.254.169.254")]
    [TestCase("::ffff:10.0.0.1")]
    [TestCase("::127.0.0.1")] // IPv4-compatible
    [TestCase("64:ff9b::7f00:1")] // NAT64 of 127.0.0.1
    [TestCase("2002:7f00:1::1")] // 6to4 of 127.0.0.1
    [TestCase("2002:a00:1::1")] // 6to4 of 10.0.0.1
    public void A_private_loopback_link_local_or_reserved_address_is_refused(string address) =>
        WebhookAddressPolicy.IsPublic(IPAddress.Parse(address)).ShouldBeFalse();

    [Test]
    public void A_link_local_address_with_a_scope_is_refused() =>
        WebhookAddressPolicy.IsPublic(IPAddress.Parse("fe80::1%3")).ShouldBeFalse();

    [TestCase("https://hooks.example.com/elysion", "https://hooks.example.com/elysion")]
    [TestCase("  https://hooks.example.com:8443/a?b=c  ", "https://hooks.example.com:8443/a?b=c")]
    [TestCase("https://8.8.8.8/hook", "https://8.8.8.8/hook")]
    public void A_public_https_url_is_registered(string text, string expected)
    {
        WebhookUrl.TryValidate(text, new WebhookOptions(), out var url, out _).ShouldBeTrue();
        url.ShouldBe(expected);
    }

    [TestCase(null, "between 1 and")]
    [TestCase("", "between 1 and")]
    [TestCase("hooks.example.com/x", "absolute https URL")]
    [TestCase("ftp://hooks.example.com/x", "absolute https URL")]
    [TestCase("http://hooks.example.com/x", "Only https URLs")]
    [TestCase("https://user:pass@hooks.example.com/x", "user name")]
    [TestCase("https://hooks.example.com/x#y", "fragment")]
    [TestCase("https://localhost/x", "public address")]
    [TestCase("https://api.localhost/x", "public address")]
    [TestCase("https://127.0.0.1/x", "public address")]
    [TestCase("https://169.254.169.254/latest/meta-data", "public address")]
    [TestCase("https://[::1]/x", "public address")]
    [TestCase("https://[::ffff:10.0.0.1]/x", "public address")]
    public void Anything_else_is_refused_with_a_reason(string? text, string reason)
    {
        WebhookUrl.TryValidate(text, new WebhookOptions(), out _, out var error).ShouldBeFalse();
        error.ShouldContain(reason);
    }

    [Test]
    public void A_url_longer_than_the_limit_is_refused() =>
        WebhookUrl.TryValidate("https://hooks.example.com/" + new string('a', 2000), new WebhookOptions(), out _, out _)
            .ShouldBeFalse();

    [Test]
    public void The_development_flags_allow_http_and_a_local_receiver()
    {
        var development = new WebhookOptions { AllowHttp = true, AllowPrivateNetworks = true };

        WebhookUrl.TryValidate("http://localhost:9000/hook", development, out var url, out _).ShouldBeTrue();
        url.ShouldBe("http://localhost:9000/hook");
    }

    [Test]
    public void A_log_line_gets_the_host_and_never_the_path_or_the_query() =>
        WebhookUrl.HostOf("https://hooks.example.com:8443/t/secret-path?token=abc").ShouldBe("hooks.example.com:8443");
}
