using System.Net;
using System.Net.Sockets;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>Resolves a host name; the tests give names their own addresses.</summary>
public interface IWebhookHostResolver
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken);
}

public sealed class DnsWebhookHostResolver : IWebhookHostResolver
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
        Dns.GetHostAddressesAsync(host, cancellationToken);
}

/// <summary>The connection was not made because every address of the host is refused (SSRF, ADR 0033).</summary>
public sealed class WebhookAddressRefusedException(string message) : IOException(message);

/// <summary>
/// The HTTP handler of the webhook worker (ADR 0033, SSRF). It resolves the host itself, keeps only the addresses
/// <see cref="WebhookAddressPolicy"/> allows, and connects the socket to one of those: the address that was checked is the address
/// that is used, so a name that resolves differently a moment later (DNS rebinding) changes nothing. Redirects are not followed
/// (a 3xx is a failed delivery), no proxy is used (it would make the connection instead), no cookies are kept.
/// </summary>
public static class WebhookHttpHandler
{
    public static SocketsHttpHandler Create(WebhookOptions options, IWebhookHostResolver resolver)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(resolver);
        return new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseProxy = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(10),
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            ConnectCallback = (context, cancellationToken) =>
                ConnectAsync(context.DnsEndPoint, options, resolver, cancellationToken),
        };
    }

    /// <summary>The addresses of <paramref name="host"/> a webhook may connect to; an address literal is not resolved.</summary>
    public static async Task<IReadOnlyList<IPAddress>> AllowedAddressesAsync(string host,
        WebhookOptions options,
        IWebhookHostResolver resolver,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(resolver);
        var literal = host.Trim('[', ']');
        var addresses = IPAddress.TryParse(literal, out var address)
            ? [address]
            : await resolver.ResolveAsync(host, cancellationToken);
        return options.AllowPrivateNetworks
            ? addresses
            : addresses.Where(WebhookAddressPolicy.IsPublic).ToList();
    }

    private static async ValueTask<Stream> ConnectAsync(DnsEndPoint endpoint,
        WebhookOptions options,
        IWebhookHostResolver resolver,
        CancellationToken cancellationToken)
    {
        var allowed = await AllowedAddressesAsync(endpoint.Host, options, resolver, cancellationToken);
        if (allowed.Count == 0)
        {
            throw new WebhookAddressRefusedException(
                "The host resolves to no public address (private, loopback and link-local addresses are refused).");
        }

        Exception? last = null;
        foreach (var address in allowed)
        {
            Socket? socket = new(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
            try
            {
                socket.NoDelay = true;
                await socket.ConnectAsync(new IPEndPoint(address, endpoint.Port), cancellationToken);
                var stream = new NetworkStream(socket, ownsSocket: true);
                socket = null; // the stream owns it now
                return stream;
            }
            catch (SocketException e)
            {
                last = e;
            }
            finally
            {
                socket?.Dispose();
            }
        }

        throw new IOException("No address of the host accepted the connection.", last);
    }
}
