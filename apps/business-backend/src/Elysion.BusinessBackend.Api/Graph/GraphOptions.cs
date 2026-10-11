using System.Text.RegularExpressions;

namespace Elysion.BusinessBackend.Api.Graph;

/// <summary>
/// The optional second source of group members (#667, ADR 0027): Microsoft Graph reads the members of the linked groups so that a group
/// is complete before its people have ever signed in. Off unless the tenant, the client and its secret are all set. The secret comes
/// from the environment or a secret store only; nothing logs it.
/// </summary>
public sealed partial class GraphOptions
{
    public const string TenantIdSetting = "GRAPH_TENANT_ID";
    public const string ClientIdSetting = "GRAPH_CLIENT_ID";
    public const string ClientSecretSetting = "GRAPH_CLIENT_SECRET";
    public const string SyncIntervalSetting = "GRAPH_SYNC_INTERVAL";
    public const string AuthoritySetting = "GRAPH_AUTHORITY";
    public const string BaseUrlSetting = "GRAPH_BASE_URL";

    public const string DefaultAuthority = "https://login.microsoftonline.com";
    public const string DefaultBaseUrl = "https://graph.microsoft.com/v1.0/";

    /// <summary>The shortest time between two runs, so that a typo cannot make the job hammer the directory.</summary>
    public static readonly TimeSpan MinimumInterval = TimeSpan.FromMinutes(5);

    public static readonly TimeSpan DefaultInterval = TimeSpan.FromHours(1);

    public string TenantId { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";

    /// <summary>Where the token comes from; another cloud (for example the US government or China) has another address, and the tests have their own.</summary>
    public string Authority { get; set; } = DefaultAuthority;

    /// <summary>The Graph API root, with the version, ending in a slash.</summary>
    public string BaseUrl { get; set; } = DefaultBaseUrl;

    public TimeSpan Interval { get; set; } = DefaultInterval;

    /// <summary>Whether the job runs: all three of tenant, client and secret are set and the tenant can be put into an address.</summary>
    public bool Enabled =>
        !string.IsNullOrWhiteSpace(TenantId)
        && !string.IsNullOrWhiteSpace(ClientId)
        && !string.IsNullOrWhiteSpace(ClientSecret)
        && TenantPattern().IsMatch(TenantId.Trim());

    /// <summary>
    /// The interval from a setting: a whole number is minutes, anything else is read as a time span (<c>01:00:00</c>). Empty or unusable
    /// gives the default; the result is never shorter than <see cref="MinimumInterval"/>.
    /// </summary>
    public static TimeSpan ParseInterval(string? setting)
    {
        if (string.IsNullOrWhiteSpace(setting))
        {
            return DefaultInterval;
        }

        var text = setting.Trim();
        TimeSpan value;
        if (int.TryParse(text, out var minutes) && minutes > 0)
        {
            value = TimeSpan.FromMinutes(minutes);
        }
        else if (!TimeSpan.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, out value) ||
                 value <= TimeSpan.Zero)
        {
            return DefaultInterval;
        }

        return value < MinimumInterval ? MinimumInterval : value;
    }

    // A tenant is a GUID or a domain name; it becomes a segment of the token address, so nothing else may get through.
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")]
    private static partial Regex TenantPattern();
}
