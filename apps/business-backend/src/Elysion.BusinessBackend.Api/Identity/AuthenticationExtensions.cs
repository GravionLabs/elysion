using System.Text;

using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Logging;

using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Elysion.BusinessBackend.Api.Identity;

public static class AuthenticationExtensions
{
    /// <summary>The default scheme: forwards to the access-token scheme or to the Keycloak one, by the token's prefix.</summary>
    public const string SelectorScheme = "Elysion";

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
                // Not set: the default. Set to an empty value: the sync of groups is off.
                options.GroupsClaim = configuration[OidcOptions.GroupsClaimSetting] ?? OidcOptions.DefaultGroupsClaim;
                options.AdminRole = configuration[OidcOptions.AdminRoleSetting] ?? OidcOptions.DefaultAdminRole;
            })
            .ValidateDataAnnotations()
            .ValidateOnStart();

        // The internal document API takes the realtime service's own token, and only on its endpoints (ADR 0017).
        services.AddOptions<InternalApiOptions>()
            .Configure<IConfiguration>((options, configuration) =>
                options.Secret = configuration[InternalApiOptions.SecretSetting] ?? "")
            .ValidateDataAnnotations()
            .ValidateOnStart();

        // The default scheme picks by the token: a personal access token (`elp_...`, ADR 0033) is looked up by its hash, anything
        // else is validated as a Keycloak token. The internal API names its own scheme and accepts neither.
        services.AddAuthentication(SelectorScheme)
            .AddPolicyScheme(SelectorScheme,
                null,
                options => options.ForwardDefaultSelector = context =>
                    AccessTokenSecrets.FromAuthorizationHeader(context.Request.Headers.Authorization) is null
                        ? JwtBearerDefaults.AuthenticationScheme
                        : AccessTokenAuthenticationHandler.SchemeName)
            .AddJwtBearer()
            .AddJwtBearer(InternalApiOptions.Scheme, _ => { })
            .AddScheme<AuthenticationSchemeOptions, AccessTokenAuthenticationHandler>(
                AccessTokenAuthenticationHandler.SchemeName,
                _ => { });
        services.AddOptions<JwtBearerOptions>(InternalApiOptions.Scheme)
            .Configure<IOptions<InternalApiOptions>>((jwt, internalApi) =>
            {
                jwt.MapInboundClaims = false;
                jwt.Events = new JwtBearerEvents
                {
                    OnAuthenticationFailed = context =>
                    {
                        AuthenticationFailureLog.TokenRejected(context);
                        return Task.CompletedTask;
                    },
                    OnChallenge = context =>
                    {
                        AuthenticationFailureLog.TokenMissing(context);
                        return Task.CompletedTask;
                    },
                };
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    // A shared secret, no key discovery: HS256 and nothing else, so a token cannot pick another algorithm.
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(internalApi.Value.Secret)),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    RequireSignedTokens = true,
                    ValidateIssuerSigningKey = true,
                    ValidateIssuer = true,
                    ValidIssuer = InternalApiOptions.Issuer,
                    ValidateAudience = true,
                    ValidAudience = InternalApiOptions.Audience,
                    ValidateLifetime = true,
                    RequireExpirationTime = true,
                    ClockSkew = TimeSpan.FromSeconds(5),
                };
            });
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<OidcOptions>, IHttpClientFactory, TimeProvider>((jwt, oidc, httpFactory, time) =>
            {
                var settings = oidc.Value;
                var issuer = settings.IssuerUrl.TrimEnd('/');
                jwt.MapInboundClaims = false; // keep the claim names of the token (`sub`, `email`)
                jwt.Events = new JwtBearerEvents
                {
                    OnAuthenticationFailed = context =>
                    {
                        AuthenticationFailureLog.TokenRejected(context);
                        return Task.CompletedTask;
                    },
                };
                // Discovery by default: Authority is the issuer, keys come from its metadata (never pinned in config).
                jwt.Authority = issuer;
                jwt.RequireHttpsMetadata = issuer.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
                if (!string.IsNullOrWhiteSpace(settings.JwksUri))
                {
                    jwt.ConfigurationManager = new JwksConfigurationManager(
                        new Uri(settings.JwksUri),
                        issuer,
                        httpFactory.CreateClient(nameof(JwksConfigurationManager)),
                        time);
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
        services.AddSingleton<IClaimsTransformation, RealmRolesClaimsTransformation>();

        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
            // Only the internal scheme counts here: a Keycloak token (a user's) does not open the internal API.
            .AddPolicy(InternalApiOptions.Policy,
                policy =>
                    policy.AddAuthenticationSchemes(InternalApiOptions.Scheme).RequireAuthenticatedUser());
        return services;
    }
}
