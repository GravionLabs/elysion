using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Identity;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// The internal document API takes the realtime service's own token and nothing else (ADR 0017), and that token opens
/// nothing else.
/// </summary>
public class InternalApiAuthenticationTests
{
    private const string Url = "/internal/boards/some-board/document";
    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp() => _factory = new ApiFactory();

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private async Task<HttpStatusCode> GetAsync(string? token, string path = Url, string scheme = "Bearer")
    {
        using var client = _factory.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(scheme, token);
        }

        return (await client.GetAsync(path)).StatusCode;
    }

    [Test]
    public async Task Without_a_token_it_is_401() => (await GetAsync(null)).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task With_the_realtime_services_token_the_request_reaches_the_handler()
    {
        // 404, not 401: the request got through, there is just no document yet.
        (await GetAsync(ApiFactory.CreateInternalToken())).ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Every_method_of_the_document_api_needs_the_token()
    {
        using var client = _factory.CreateClient();
        using var content = new ByteArrayContent([1]);

        (await client.PutAsync(Url, content)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.DeleteAsync(Url)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.GetAsync(Url)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task An_ordinary_users_access_token_does_not_open_it()
    {
        (await GetAsync(ApiFactory.CreateToken())).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task The_realtime_services_token_opens_nothing_else()
    {
        var token = ApiFactory.CreateInternalToken();

        (await GetAsync(token, "/boards")).ShouldBe(HttpStatusCode.Unauthorized);
        (await GetAsync(token, $"/boards/{Guid.NewGuid()}")).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task A_token_signed_with_another_secret_is_401() =>
        (await GetAsync(ApiFactory.CreateInternalToken(secret: "another-secret-that-is-at-least-32-characters"))).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task A_token_of_another_issuer_or_audience_is_401()
    {
        (await GetAsync(ApiFactory.CreateInternalToken(issuer: "elysion-bff"))).ShouldBe(HttpStatusCode.Unauthorized);
        (await GetAsync(ApiFactory.CreateInternalToken(audience: "elysion-realtime"))).ShouldBe(HttpStatusCode.Unauthorized);
        (await GetAsync(ApiFactory.CreateInternalToken(audience: null))).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task An_expired_token_is_401() =>
        (await GetAsync(ApiFactory.CreateInternalToken(lifetime: TimeSpan.FromMinutes(-10)))).ShouldBe(HttpStatusCode.Unauthorized);

    [Test]
    public async Task A_token_that_lives_for_a_minute_is_accepted_and_one_that_ended_a_few_seconds_ago_still_is_within_the_skew()
    {
        (await GetAsync(ApiFactory.CreateInternalToken(lifetime: TimeSpan.FromSeconds(60)))).ShouldBe(HttpStatusCode.NotFound);
        (await GetAsync(ApiFactory.CreateInternalToken(lifetime: TimeSpan.FromSeconds(-2)))).ShouldBe(HttpStatusCode.NotFound);
        (await GetAsync(ApiFactory.CreateInternalToken(lifetime: TimeSpan.FromSeconds(-30)))).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Only_HS256_is_accepted()
    {
        // The shared secret is shorter than HS512 needs, so such a token cannot even be made here; the parameters say it.
        var parameters = _factory.Services
            .GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(InternalApiOptions.Scheme)
            .TokenValidationParameters;
        parameters.ValidAlgorithms.ShouldBe([SecurityAlgorithms.HmacSha256]);

        static string B64(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var exp = DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeSeconds();
        var unsigned = $"{B64("""{"alg":"none","typ":"JWT"}""")}.{B64($$"""{"iss":"{{InternalApiOptions.Issuer}}","aud":"{{InternalApiOptions.Audience}}","exp":{{exp}}}""")}.";
        (await GetAsync(unsigned)).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Garbage_and_the_wrong_scheme_are_401()
    {
        (await GetAsync("not-a-jwt")).ShouldBe(HttpStatusCode.Unauthorized);
        (await GetAsync(ApiFactory.CreateInternalToken(), scheme: "Basic")).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task The_service_is_no_user_so_its_requests_create_none()
    {
        await GetAsync(ApiFactory.CreateInternalToken());

        using var scope = _factory.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<ElysionDbContext>().Users.CountAsync()).ShouldBe(0);
    }

    [Test]
    public async Task Health_stays_open()
    {
        (await GetAsync(null, "/health")).ShouldBe(HttpStatusCode.OK);
    }
}
