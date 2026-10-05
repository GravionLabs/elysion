using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using Elysion.BusinessBackend.Api.Identity;
using Microsoft.IdentityModel.Tokens;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class AuthenticationTests
{
    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp() => _factory = new ApiFactory();

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private async Task<HttpStatusCode> GetBoardsAsync(string? token, string scheme = "Bearer")
    {
        using var client = _factory.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(scheme, token);
        }

        return (await client.GetAsync("/boards")).StatusCode;
    }

    [Test]
    public async Task A_request_without_a_token_is_401() =>
        (await GetBoardsAsync(null)).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task A_request_with_a_valid_token_is_200() =>
        (await GetBoardsAsync(ApiFactory.CreateToken())).ShouldBe(HttpStatusCode.OK);

    [Test]
    public async Task The_401_asks_for_a_bearer_token()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/boards");

        response.Headers.WwwAuthenticate.Single().Scheme.ShouldBe("Bearer");
    }

    [Test]
    public async Task A_token_for_another_audience_is_401() =>
        (await GetBoardsAsync(ApiFactory.CreateToken(audience: "account"))).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task A_token_without_an_audience_is_401() =>
        (await GetBoardsAsync(ApiFactory.CreateToken(audience: null))).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task An_expired_token_is_401() =>
        (await GetBoardsAsync(ApiFactory.CreateToken(lifetime: TimeSpan.FromMinutes(-10)))).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task A_token_from_another_issuer_is_401() =>
        (await GetBoardsAsync(ApiFactory.CreateToken(issuer: "http://evil.test/realms/elysion"))).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task A_token_signed_with_another_key_is_401()
    {
        var otherKey = new RsaSecurityKey(RSA.Create(2048)) { KeyId = "test-key" }; // same key id, other key

        (await GetBoardsAsync(ApiFactory.CreateToken(signingKey: otherKey))).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task An_unsigned_token_is_401()
    {
        static string B64(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var exp = DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeSeconds();
        var token = $"{B64("""{"alg":"none","typ":"JWT"}""")}.{B64($$"""{"sub":"x","iss":"{{ApiFactory.Issuer}}","aud":"{{ApiFactory.Audience}}","exp":{{exp}}}""")}.";

        (await GetBoardsAsync(token)).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Garbage_and_the_wrong_scheme_are_401()
    {
        (await GetBoardsAsync("not-a-jwt")).ShouldBe(HttpStatusCode.Unauthorized);
        (await GetBoardsAsync(ApiFactory.CreateToken(), "Basic")).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Every_board_endpoint_requires_a_token()
    {
        using var client = _factory.CreateClient();
        var id = Guid.NewGuid();
        var json = new StringContent("""{"name":"x"}""", Encoding.UTF8, "application/json");

        (await client.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.GetAsync($"/boards/{id}")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.PostAsync("/boards", json)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.PatchAsync($"/boards/{id}", json)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.PostAsync($"/boards/{id}/duplicate", null)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.DeleteAsync($"/boards/{id}")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Health_stays_open_for_container_health_checks()
    {
        using var client = _factory.CreateClient();

        (await client.GetAsync("/health")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task The_internal_document_api_stays_open_for_the_realtime_service()
    {
        using var client = _factory.CreateClient();

        // 404, not 401: the request got to the handler, there is just no document yet.
        (await client.GetAsync("/internal/boards/some-board/document")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public void Options_without_an_issuer_or_audience_stop_the_application_at_startup()
    {
        using var factory = new ApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseSetting(OidcOptions.IssuerSetting, "");
            builder.UseSetting(OidcOptions.AudienceSetting, "");
        });

        Should.Throw<Exception>(() => factory.CreateClient());
    }
}
