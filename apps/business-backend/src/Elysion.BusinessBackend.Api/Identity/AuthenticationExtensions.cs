using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Elysion.BusinessBackend.Api.Identity;

public static class AuthenticationExtensions
{
    /// <summary>
    /// Keycloak access tokens as the only way in (docs/specs/identity.md): JWT bearer authentication, and a
    /// fallback policy that makes every endpoint require an authenticated user unless it opts out with
    /// <c>AllowAnonymous</c> (health, the internal document API). The service validates tokens, it never issues them.
    /// </summary>
    public static IServiceCollection AddElysionAuthentication(this IServiceCollection services)
    {
        services.AddOptions<OidcOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                options.IssuerUrl = configuration[OidcOptions.IssuerSetting] ?? "";
                options.Audience = configuration[OidcOptions.AudienceSetting] ?? "";
                options.JwksUri = configuration[OidcOptions.JwksUriSetting];
            })
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<OidcOptions>, IHttpClientFactory, TimeProvider>((jwt, oidc, httpFactory, time) =>
            {
                var settings = oidc.Value;
                var issuer = settings.IssuerUrl.TrimEnd('/');
                jwt.MapInboundClaims = false; // keep the claim names of the token (`sub`, `email`)
                // Discovery by default: Authority is the issuer, keys come from its metadata (never pinned in config).
                jwt.Authority = issuer;
                jwt.RequireHttpsMetadata = issuer.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
                if (!string.IsNullOrWhiteSpace(settings.JwksUri))
                {
                    jwt.ConfigurationManager = new JwksConfigurationManager(
                        new Uri(settings.JwksUri), issuer, httpFactory.CreateClient(nameof(JwksConfigurationManager)), time);
                }

                // Every check is explicit and on, also in Development.
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = issuer,
                    ValidateAudience = true,
                    ValidAudience = settings.Audience,
                    ValidateLifetime = true,
                    RequireExpirationTime = true,
                    ValidateIssuerSigningKey = true,
                    RequireSignedTokens = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                };
            });
        services.AddHttpClient(nameof(JwksConfigurationManager));

        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
        return services;
    }
}
