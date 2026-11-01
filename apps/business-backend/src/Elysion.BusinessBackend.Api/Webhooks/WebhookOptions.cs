namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>
/// The webhooks' settings (ADR 0033, #853). Both flags are for development and tests only: in production a webhook goes to an
/// <c>https</c> URL on a public address, never into the network Elysion runs in.
/// </summary>
public sealed class WebhookOptions
{
    /// <summary><c>true</c> accepts plain <c>http</c> URLs (a receiver on the developer's machine).</summary>
    public const string AllowHttpSetting = "WEBHOOKS_ALLOW_HTTP";

    /// <summary><c>true</c> lets the worker connect to private, loopback and link-local addresses (a receiver on the host).</summary>
    public const string AllowPrivateNetworksSetting = "WEBHOOKS_ALLOW_PRIVATE_NETWORKS";

    /// <summary><c>false</c> stops this instance from sending (another one does); on by default.</summary>
    public const string WorkerEnabledSetting = "WEBHOOKS_WORKER_ENABLED";

    public bool AllowHttp { get; set; }
    public bool AllowPrivateNetworks { get; set; }
    public bool WorkerEnabled { get; set; } = true;

    /// <summary>How often the worker looks for due deliveries.</summary>
    public TimeSpan PollInterval { get; set; } = TimeSpan.FromSeconds(2);
}
