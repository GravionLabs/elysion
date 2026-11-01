using System.Net;

using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// The check of a URL when an endpoint is registered: absolute, <c>https</c> (<c>http</c> only with
/// <see cref="WebhookOptions.AllowHttp"/>), no user name or password, no fragment, and no host that is plainly internal (an address
/// literal of a refused range, <c>localhost</c>). It is a first answer for the person; the real check is made by the worker on the
/// address it connects to (<see cref="WebhookHttpHandler"/>), because a name can resolve to anything later.
/// </summary>
public static class WebhookUrl
{
    public static bool TryValidate(string? text, WebhookOptions options, out string url, out string error)
    {
        ArgumentNullException.ThrowIfNull(options);
        url = "";
        var trimmed = text?.Trim() ?? "";
        if (trimmed.Length is 0 or > WebhookEndpoint.MaxUrlLength)
        {
            error = $"The URL must be between 1 and {WebhookEndpoint.MaxUrlLength} characters.";
            return false;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            || string.IsNullOrEmpty(uri.Host))
        {
            error = "The URL must be an absolute https URL.";
            return false;
        }

        if (uri.Scheme == Uri.UriSchemeHttp && !options.AllowHttp)
        {
            error = "Only https URLs are allowed.";
            return false;
        }

        if (uri.UserInfo.Length > 0 || uri.Fragment.Length > 0)
        {
            error = "The URL must not contain a user name, a password or a fragment.";
            return false;
        }

        if (!options.AllowPrivateNetworks && IsPlainlyInternal(uri))
        {
            error = "The URL must point to a public address, not to a private, loopback or link-local one.";
            return false;
        }

        url = uri.AbsoluteUri;
        error = "";
        return true;
    }

    /// <summary>The host and port only, for a log line: never the path or the query, which may carry a secret of the receiver.</summary>
    public static string HostOf(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Authority : "(invalid)";

    private static bool IsPlainlyInternal(Uri uri)
    {
        var host = uri.IdnHost.Trim('[', ']');
        if (IPAddress.TryParse(host, out var address))
        {
            return !WebhookAddressPolicy.IsPublic(address);
        }

        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
               || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);
    }
}
