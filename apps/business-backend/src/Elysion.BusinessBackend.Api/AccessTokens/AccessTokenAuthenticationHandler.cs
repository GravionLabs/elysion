using System.Security.Claims;
using System.Text.Encodings.Web;

using Elysion.BusinessBackend.Api.Data.Repositories;

using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.AccessTokens;

/// <summary>
/// The third authentication scheme (ADR 0033): a personal access token, <c>Authorization: Bearer elp_...</c>. The token is hashed
/// and looked up; an unknown, revoked or expired one is refused (<c>401</c>). A usable one makes the token's owner the principal
/// (<c>sub</c> is the owner's subject, so everything that follows treats the request as theirs) with the token's id and scopes as
/// claims. The lookup is cached for <see cref="CacheDuration"/> per instance; revoking removes the entry of this instance, so a
/// revoke takes effect within that time everywhere. A deactivated owner is refused by the provisioning step on every request.
/// </summary>
public sealed partial class AccessTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory loggerFactory,
    UrlEncoder encoder,
    IAccessTokenRepository tokens,
    IMemoryCache cache,
    TimeProvider time)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, loggerFactory, encoder)
{
    public const string SchemeName = "AccessToken";

    /// <summary>The claim with the token's id (logged, never the token).</summary>
    public const string TokenIdClaim = "elysion_token_id";

    /// <summary>The claim with the token's scopes, separated by a space (the name of the OAuth claim).</summary>
    public const string ScopeClaim = "scope";

    /// <summary>How long a lookup is remembered; a revoke on another instance takes effect after it at the latest.</summary>
    public static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    private readonly ILogger _log = loggerFactory.CreateLogger("Elysion.BusinessBackend.Api.Authentication");

    /// <summary>The cache key of a token's lookup; also what a revoke removes.</summary>
    public static object CacheKey(string hash) => (typeof(AccessTokenAuthenticationHandler), hash);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = AccessTokenSecrets.FromAuthorizationHeader(Request.Headers.Authorization);
        if (token is null)
        {
            return AuthenticateResult.NoResult();
        }

        if (!AccessTokenSecrets.LooksValid(token))
        {
            return Refuse("malformed");
        }

        var hash = AccessTokenSecrets.Hash(token);
        var grant = await cache.GetOrCreateAsync(CacheKey(hash),
            entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = CacheDuration;
                return tokens.FindGrantByHashAsync(hash, Context.RequestAborted);
            });
        var now = time.GetUtcNow();
        if (grant is null)
        {
            return Refuse("unknown");
        }

        if (grant.RevokedAt is not null)
        {
            return Refuse("revoked");
        }

        if (now >= grant.ExpiresAt)
        {
            return Refuse("expired");
        }

        await MarkUsedAsync(grant, now);

        var identity = new ClaimsIdentity(
            [
                new Claim("sub", grant.OwnerSubject),
                new Claim(TokenIdClaim, grant.Id.ToString()),
                new Claim(ScopeClaim, string.Join(' ', grant.Scopes)),
            ],
            SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    /// <summary>Writes the last use at most once per <see cref="Entities.AccessToken.UseInterval"/> and instance.</summary>
    private async Task MarkUsedAsync(AccessTokenGrant grant, DateTimeOffset now)
    {
        if (grant.LastUsedAt is { } last && now - last < Entities.AccessToken.UseInterval)
        {
            return;
        }

        // The cached grant keeps the use it was read with: remember this instance's last write, by the injected clock.
        var key = (typeof(AccessTokenAuthenticationHandler), "used", grant.Id);
        if (cache.TryGetValue(key, out DateTimeOffset marked) && now - marked < Entities.AccessToken.UseInterval)
        {
            return;
        }

        cache.Set(key, now, Entities.AccessToken.UseInterval);
        await tokens.MarkUsedAsync(grant.Id, now, Context.RequestAborted);
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }

    private AuthenticateResult Refuse(string reason)
    {
        AccessTokenRejected(_log, reason, SchemeName);
        return AuthenticateResult.Fail($"The access token is {reason}.");
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Bearer token rejected: {Reason} (scheme {Scheme})")]
    private static partial void AccessTokenRejected(ILogger logger, string reason, string scheme);
}
