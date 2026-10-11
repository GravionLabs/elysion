using Elysion.BusinessBackend.Api.Graph;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

public class GraphOptionsTests
{
    [Test]
    public void The_sync_is_on_only_when_tenant_client_and_secret_are_all_set()
    {
        new GraphOptions().Enabled.ShouldBeFalse();
        new GraphOptions { TenantId = "t", ClientId = "c" }.Enabled.ShouldBeFalse();
        new GraphOptions { TenantId = "t", ClientSecret = "s" }.Enabled.ShouldBeFalse();
        new GraphOptions { ClientId = "c", ClientSecret = "s" }.Enabled.ShouldBeFalse();
        new GraphOptions { TenantId = "t", ClientId = "c", ClientSecret = "s" }.Enabled.ShouldBeTrue();
        new GraphOptions { TenantId = "contoso.onmicrosoft.com", ClientId = "c", ClientSecret = "s" }.Enabled
            .ShouldBeTrue();
    }

    [TestCase("a/b")]
    [TestCase("../x")]
    [TestCase("t?x=1")]
    [TestCase("t t")]
    public void A_tenant_that_cannot_be_a_segment_of_an_address_switches_the_sync_off(string tenant) =>
        new GraphOptions { TenantId = tenant, ClientId = "c", ClientSecret = "s" }.Enabled.ShouldBeFalse();

    [TestCase(null, 60)]
    [TestCase("", 60)]
    [TestCase("15", 15)]
    [TestCase("2", 5)]
    [TestCase("00:30:00", 30)]
    [TestCase("00:01:00", 5)]
    [TestCase("nonsense", 60)]
    [TestCase("-5", 60)]
    public void The_interval_is_minutes_or_a_time_span_and_never_below_five_minutes(string? setting, int minutes) =>
        GraphOptions.ParseInterval(setting).ShouldBe(TimeSpan.FromMinutes(minutes));
}
