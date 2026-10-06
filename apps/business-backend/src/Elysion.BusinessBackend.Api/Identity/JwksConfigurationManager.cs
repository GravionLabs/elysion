using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Signing keys from a JWKS address, for the case where the issuer in the tokens is not an address this
/// service can reach (inside the compose network). It stands in for the discovery document: the issuer
/// is the configured one, the keys are the ones at the address. Keys are cached and fetched again when
/// the handler asks (a token signed with an unknown key, after a key rotation), at most every 30 seconds.
/// </summary>
public sealed class JwksConfigurationManager(Uri jwksUri, string issuer, HttpClient http, TimeProvider time)
    : IConfigurationManager<OpenIdConnectConfiguration>, IDisposable
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan MinimumRefreshInterval = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim _lock = new(1, 1);
    private OpenIdConnectConfiguration? _configuration;
    private DateTimeOffset _fetchedAt;
    private bool _refreshRequested;

    public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancel)
    {
        await _lock.WaitAsync(cancel);
        try
        {
            var age = time.GetUtcNow() - _fetchedAt;
            var due = _configuration is null || age >= RefreshInterval
                || (_refreshRequested && age >= MinimumRefreshInterval);
            if (due)
            {
                _configuration = await FetchAsync(cancel);
                _fetchedAt = time.GetUtcNow();
                _refreshRequested = false;
            }

            return _configuration!;
        }
        finally
        {
            _lock.Release();
        }
    }

    public void RequestRefresh() => _refreshRequested = true;

    public void Dispose() => _lock.Dispose();

    private async Task<OpenIdConnectConfiguration> FetchAsync(CancellationToken cancel)
    {
        var json = await http.GetStringAsync(jwksUri, cancel);
        var configuration = new OpenIdConnectConfiguration { Issuer = issuer, JwksUri = jwksUri.ToString() };
        foreach (var key in new JsonWebKeySet(json).GetSigningKeys())
        {
            configuration.SigningKeys.Add(key);
        }

        return configuration;
    }
}
