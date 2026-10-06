using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Identity;

using Microsoft.IdentityModel.Tokens;

using NSubstitute;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class JwksConfigurationManagerTests
{
    private static readonly Uri JwksUri = new("http://keycloak:8080/realms/elysion/protocol/openid-connect/certs");
    private const string Issuer = "http://localhost:8081/realms/elysion";

    private sealed class FakeKeycloak : HttpMessageHandler
    {
        public int Requests { get; private set; }
        public List<string> KeyIds { get; } = ["key-1"];
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests++;
            request.RequestUri.ShouldBe(JwksUri);
            var keys = KeyIds.Select(id =>
            {
                var parameters = RSA.Create(2048).ExportParameters(false);
                return new
                {
                    kty = "RSA",
                    use = "sig",
                    alg = "RS256",
                    kid = id,
                    n = Base64UrlEncoder.Encode(parameters.Modulus),
                    e = Base64UrlEncoder.Encode(parameters.Exponent),
                };
            });
            return Task.FromResult(new HttpResponseMessage(Status)
                { Content = new StringContent(JsonSerializer.Serialize(new { keys })) });
        }
    }

    private static (JwksConfigurationManager Manager, FakeKeycloak Keycloak, TimeProvider Time, DateTimeOffset[] Now)
        Create()
    {
        var keycloak = new FakeKeycloak();
        var now = new[] { new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero) };
        var time = Substitute.For<TimeProvider>();
        time.GetUtcNow().Returns(_ => now[0]);
        return (new JwksConfigurationManager(JwksUri, Issuer, new HttpClient(keycloak), time), keycloak, time, now);
    }

    [Test]
    public async Task Gives_the_configured_issuer_and_the_keys_at_the_address()
    {
        var (manager, _, _, _) = Create();

        var configuration = await manager.GetConfigurationAsync(CancellationToken.None);

        configuration.Issuer.ShouldBe(Issuer);
        configuration.SigningKeys.Select(k => k.KeyId).ShouldBe(["key-1"]);
    }

    [Test]
    public async Task Caches_the_keys()
    {
        var (manager, keycloak, _, _) = Create();

        await manager.GetConfigurationAsync(CancellationToken.None);
        await manager.GetConfigurationAsync(CancellationToken.None);

        keycloak.Requests.ShouldBe(1);
    }

    [Test]
    public async Task Fetches_again_after_an_hour()
    {
        var (manager, keycloak, _, now) = Create();
        await manager.GetConfigurationAsync(CancellationToken.None);

        now[0] = now[0].AddMinutes(61);
        await manager.GetConfigurationAsync(CancellationToken.None);

        keycloak.Requests.ShouldBe(2);
    }

    [Test]
    public async Task A_requested_refresh_fetches_again_but_not_more_often_than_every_30_seconds()
    {
        var (manager, keycloak, _, now) = Create();
        await manager.GetConfigurationAsync(CancellationToken.None);
        keycloak.KeyIds.Add("key-2"); // the realm rotated its keys

        manager.RequestRefresh();
        (await manager.GetConfigurationAsync(CancellationToken.None)).SigningKeys.Count.ShouldBe(1); // too soon
        now[0] = now[0].AddSeconds(31);
        manager.RequestRefresh();
        var refreshed = await manager.GetConfigurationAsync(CancellationToken.None);

        refreshed.SigningKeys.Select(k => k.KeyId).ShouldBe(["key-1", "key-2"]);
        keycloak.Requests.ShouldBe(2);
    }

    [Test]
    public async Task Fails_when_the_realm_cannot_be_reached_instead_of_trusting_nothing()
    {
        var (manager, keycloak, _, _) = Create();
        keycloak.Status = HttpStatusCode.ServiceUnavailable;

        await Should.ThrowAsync<HttpRequestException>(() => manager.GetConfigurationAsync(CancellationToken.None));
    }
}
