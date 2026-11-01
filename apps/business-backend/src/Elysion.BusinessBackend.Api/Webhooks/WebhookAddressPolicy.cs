using System.Net;
using System.Net.Sockets;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// Which addresses a webhook may be sent to (ADR 0033, SSRF): public unicast ones only. Refused are the private, loopback,
/// link-local, unique-local, shared (CGNAT), multicast, documentation and reserved ranges of IPv4 and IPv6, and an IPv6 address
/// that carries an IPv4 one (mapped, compatible, NAT64, 6to4) is judged by the IPv4 address inside it.
/// </summary>
public static class WebhookAddressPolicy
{
    private static readonly IPNetwork[] RefusedV4 =
    [
        IPNetwork.Parse("0.0.0.0/8"), // "this network"
        IPNetwork.Parse("10.0.0.0/8"), // private
        IPNetwork.Parse("100.64.0.0/10"), // shared address space (CGNAT)
        IPNetwork.Parse("127.0.0.0/8"), // loopback
        IPNetwork.Parse("169.254.0.0/16"), // link-local (cloud metadata services live here)
        IPNetwork.Parse("172.16.0.0/12"), // private
        IPNetwork.Parse("192.0.0.0/24"), // IETF protocol assignments
        IPNetwork.Parse("192.0.2.0/24"), // documentation
        IPNetwork.Parse("192.88.99.0/24"), // 6to4 relay anycast
        IPNetwork.Parse("192.168.0.0/16"), // private
        IPNetwork.Parse("198.18.0.0/15"), // benchmarking
        IPNetwork.Parse("198.51.100.0/24"), // documentation
        IPNetwork.Parse("203.0.113.0/24"), // documentation
        IPNetwork.Parse("224.0.0.0/4"), // multicast
        IPNetwork.Parse("240.0.0.0/4"), // reserved, and the broadcast address
    ];

    private static readonly IPNetwork[] RefusedV6 =
    [
        IPNetwork.Parse("::/128"), // unspecified
        IPNetwork.Parse("::1/128"), // loopback
        IPNetwork.Parse("100::/64"), // discard
        IPNetwork.Parse("2001:db8::/32"), // documentation
        IPNetwork.Parse("fc00::/7"), // unique local
        IPNetwork.Parse("fe80::/10"), // link-local
        IPNetwork.Parse("fec0::/10"), // site-local (deprecated)
        IPNetwork.Parse("ff00::/8"), // multicast
    ];

    private static readonly IPNetwork Nat64 = IPNetwork.Parse("64:ff9b::/96");
    private static readonly IPNetwork SixToFour = IPNetwork.Parse("2002::/16");
    private static readonly IPNetwork V4Compatible = IPNetwork.Parse("::/96");

    /// <summary>Whether a webhook may connect to <paramref name="address"/>.</summary>
    public static bool IsPublic(IPAddress address)
    {
        ArgumentNullException.ThrowIfNull(address);
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return !RefusedV4.Any(network => network.Contains(address));
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6)
        {
            return false;
        }

        // A scope id makes it link-local whatever the bits say; the IPNetwork check ignores it.
        if (address.ScopeId != 0)
        {
            return false;
        }

        if (address.IsIPv4MappedToIPv6)
        {
            return IsPublic(address.MapToIPv4());
        }

        var bytes = address.GetAddressBytes();
        if (Nat64.Contains(address) || (V4Compatible.Contains(address) && !address.Equals(IPAddress.IPv6Loopback)
                                                                       && !address.Equals(IPAddress.IPv6Any)))
        {
            return IsPublic(new IPAddress(bytes.AsSpan(12, 4)));
        }

        if (SixToFour.Contains(address))
        {
            return IsPublic(new IPAddress(bytes.AsSpan(2, 4)));
        }

        return !RefusedV6.Any(network => network.Contains(address));
    }
}
