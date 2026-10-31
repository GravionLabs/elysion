using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Authentication;
using System.Text;

namespace Elysion.BusinessBackend.Api.Webhooks;

/// <summary>How one attempt ended: success is any 2xx answer within the timeout.</summary>
public sealed record WebhookAttempt(bool Succeeded, int? ResponseStatus, int DurationMs, string? Error);

/// <summary>What the worker posts, so that a test can stand in for the network.</summary>
public interface IWebhookSender
{
    Task<WebhookAttempt> SendAsync(WebhookMessage message, CancellationToken cancellationToken);
}

/// <summary>One delivery as it goes out: where, signed with what, and the body.</summary>
public sealed record WebhookMessage(
    string Url,
    string Secret,
    Guid DeliveryId,
    Guid EventId,
    string EventType,
    string Payload);

/// <summary>
/// Posts a delivery (ADR 0033): the JSON body, signed (<see cref="WebhookSecrets.SignatureHeader"/>), with a timeout of
/// <see cref="Timeout"/>, through <see cref="WebhookHttpHandler"/> (no private addresses, no redirects). The answer's body is not
/// read. The error it reports is a few words without the URL.
/// </summary>
public sealed class WebhookSender(HttpClient http, TimeProvider time) : IWebhookSender
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    public const string UserAgent = "Elysion-Webhooks/1";

    public async Task<WebhookAttempt> SendAsync(WebhookMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        using var timeout = new CancellationTokenSource(Timeout, time);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        using var request = new HttpRequestMessage(HttpMethod.Post, message.Url);
        request.Content = new StringContent(message.Payload, Encoding.UTF8, "application/json");
        request.Headers.UserAgent.Add(ProductInfoHeaderValue.Parse(UserAgent));
        request.Headers.Add("Elysion-Event", message.EventType);
        request.Headers.Add("Elysion-Event-Id", message.EventId.ToString());
        request.Headers.Add("Elysion-Delivery", message.DeliveryId.ToString());
        request.Headers.Add(WebhookSecrets.SignatureHeader,
            WebhookSecrets.Sign(message.Secret, time.GetUtcNow().ToUnixTimeSeconds(), message.Payload));

        var started = Stopwatch.GetTimestamp();
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, linked.Token);
            var status = (int)response.StatusCode;
            var ok = response.IsSuccessStatusCode;
            return new WebhookAttempt(ok, status, Elapsed(started), ok ? null : Describe(status));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new WebhookAttempt(false, null, Elapsed(started), $"No answer within {Timeout.TotalSeconds:0} s.");
        }
        catch (HttpRequestException e)
        {
            return new WebhookAttempt(false, null, Elapsed(started), Describe(e));
        }
    }

    private static int Elapsed(long started) => (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    private static string Describe(int status) => status is >= 300 and < 400
        ? $"HTTP {status}: redirects are not followed."
        : $"HTTP {status}.";

    /// <summary>The kind of failure, never the exception's message (it can carry the URL or an address).</summary>
    private static string Describe(HttpRequestException e)
    {
        for (Exception? inner = e; inner is not null; inner = inner.InnerException)
        {
            switch (inner)
            {
                case WebhookAddressRefusedException:
                    return "Refused: the host resolves to no public address.";
                case AuthenticationException:
                    return "The TLS handshake failed.";
            }
        }

        return e.HttpRequestError switch
        {
            HttpRequestError.NameResolutionError => "The host name could not be resolved.",
            HttpRequestError.ConnectionError => "The connection could not be made.",
            HttpRequestError.SecureConnectionError => "The TLS handshake failed.",
            _ => "The request failed.",
        };
    }
}
