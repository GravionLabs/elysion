using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;

using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Files;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// Runs the real application pipeline (routing, model binding, validation, authentication) with an
/// in-memory database instead of Postgres, so no infrastructure is needed. Tokens are real JWTs signed
/// with a key made for the test run: the application validates them exactly as it would Keycloak's, only
/// the source of the signing key is replaced.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string Issuer = "http://keycloak.test/realms/elysion";
    public const string Audience = "elysion-bff";

    /// <summary>The secret of the internal API in the tests (a development value, as in appsettings.Development.json).</summary>
    /// <summary>Small limits, so the tests of the limits stay small.</summary>
    public const int MaxFileBytes = 1024;

    public const int MaxFilesPerBoard = 3;

    public const string InternalSecret = "test-only-internal-api-secret-0123456789abcdef";

    private static readonly RsaSecurityKey SigningKey = new(RSA.Create(2048)) { KeyId = "test-key" };

    /// <summary>The object store of board files; in memory, so no S3 is needed.</summary>
    public InMemoryFileStore Files { get; } = new();

    private readonly string _databaseName = Guid.NewGuid().ToString();
    private readonly TimeProvider? _time;

    public ApiFactory(TimeProvider? time = null) => _time = time;

    /// <summary>A signed access token; the defaults are what Keycloak would issue to the dev user.</summary>
    public static string CreateToken(
        string subject = "kc-sub-1",
        string? audience = Audience,
        string issuer = Issuer,
        TimeSpan? lifetime = null,
        SecurityKey? signingKey = null,
        DateTimeOffset? now = null,
        IEnumerable<Claim>? claims = null)
    {
        var issuedAt = now ?? DateTimeOffset.UtcNow;
        var expires = issuedAt + (lifetime ?? TimeSpan.FromMinutes(5));
        var descriptor = new SecurityTokenDescriptor
        {
            // `claims` replaces the default identity claims entirely (a token without `sub`, with a name, ...).
            Subject = new ClaimsIdentity(claims ??
            [
                new Claim("sub", subject), new Claim("email", $"{subject}@example.com")
            ]),
            Issuer = issuer,
            Audience = audience,
            // A lifetime that already ended: the token must have been valid before it expired, so move its start back.
            NotBefore = (expires < DateTimeOffset.UtcNow ? expires.AddMinutes(-5) : issuedAt).UtcDateTime,
            IssuedAt = (expires < DateTimeOffset.UtcNow ? expires.AddMinutes(-5) : issuedAt).UtcDateTime,
            Expires = expires.UtcDateTime,
            SigningCredentials = new SigningCredentials(signingKey ?? SigningKey, SecurityAlgorithms.RsaSha256),
        };
        return new JwtSecurityTokenHandler().CreateEncodedJwt(descriptor);
    }

    /// <summary>
    /// The token the realtime service sends to the internal API: HS256 with the shared secret, a lifetime of a minute.
    /// </summary>
    public static string CreateInternalToken(
        string issuer = InternalApiOptions.Issuer,
        string? audience = InternalApiOptions.Audience,
        TimeSpan? lifetime = null,
        string secret = InternalSecret,
        string algorithm = SecurityAlgorithms.HmacSha256)
    {
        var expires = DateTimeOffset.UtcNow + (lifetime ?? TimeSpan.FromMinutes(1));
        var started = expires < DateTimeOffset.UtcNow ? expires.AddMinutes(-5) : DateTimeOffset.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            NotBefore = started.UtcDateTime,
            IssuedAt = started.UtcDateTime,
            Expires = expires.UtcDateTime,
            SigningCredentials =
                new SigningCredentials(new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(secret)), algorithm),
        };
        return new JwtSecurityTokenHandler().CreateEncodedJwt(descriptor);
    }

    /// <summary>A client that sends the realtime service's token, for the internal document API.</summary>
    public HttpClient CreateInternalClient()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", CreateInternalToken());
        return client;
    }

    /// <summary>A client that sends a valid access token, as the BFF will for a signed-in user.</summary>
    public HttpClient CreateAuthenticatedClient(string subject = "kc-sub-1", IEnumerable<Claim>? claims = null)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", CreateToken(subject, claims: claims));
        return client;
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        // The in-memory provider has no migrations: creating the database is what applies the seed data (the built-in templates).
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<ElysionDbContext>().Database.EnsureCreated();
        return host;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting(OidcOptions.IssuerSetting, Issuer);
        builder.UseSetting(OidcOptions.AudienceSetting, Audience);
        builder.UseSetting(InternalApiOptions.SecretSetting, InternalSecret);
        builder.UseSetting(Api.Files.FileOptions.EndpointSetting, "http://s3.test");
        builder.UseSetting(Api.Files.FileOptions.AccessKeySetting, "test");
        builder.UseSetting(Api.Files.FileOptions.SecretKeySetting, "test-secret");
        builder.UseSetting(Api.Files.FileOptions.MaxFileBytesSetting,
            MaxFileBytes.ToString(System.Globalization.CultureInfo.InvariantCulture));
        builder.UseSetting(Api.Files.FileOptions.MaxFilesPerBoardSetting,
            MaxFilesPerBoard.ToString(System.Globalization.CultureInfo.InvariantCulture));
        builder.ConfigureServices(services =>
        {
            // The test key stands in for the realm's published keys; issuer, audience and lifetime are still checked.
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme,
                options =>
                    options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(
                        new OpenIdConnectConfiguration { Issuer = Issuer, SigningKeys = { SigningKey } }));

            // EF registers the provider in two places; both have to go or two providers coexist. The
            // second one (IDbContextOptionsConfiguration<T>) is an internal EF type, so it is matched by name.
            services.RemoveAll<DbContextOptions<ElysionDbContext>>();
            foreach (var descriptor in services
                         .Where(d => d.ServiceType is { IsGenericType: true } type
                                     && type.GetGenericTypeDefinition().Name == "IDbContextOptionsConfiguration`1"
                                     && type.GenericTypeArguments[0] == typeof(ElysionDbContext))
                         .ToList())
            {
                services.Remove(descriptor);
            }

            services.AddDbContext<ElysionDbContext>(options => options.UseInMemoryDatabase(_databaseName));

            services.RemoveAll<IFileStore>();
            services.AddSingleton<IFileStore>(Files);

            if (_time is not null)
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(_time);
            }
        });
    }
}
