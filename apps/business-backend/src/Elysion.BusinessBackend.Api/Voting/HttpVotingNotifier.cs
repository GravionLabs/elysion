using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Voting;

public sealed class RealtimeOptions
{
    public const string UrlSetting = "REALTIME_URL";

    /// <summary>Where the realtime service listens for internal calls, for example <c>http://realtime:3000</c>; empty switches the notification off.</summary>
    public string Url { get; set; } = "";
}

/// <summary>
/// Posts the change to <c>{REALTIME_URL}/internal/boards/{boardId}/voting</c> with a one-minute HS256 token signed with the
/// secret both services share (the mirror image of ADR 0017: here the backend is the caller). The values of the token are
/// the ones the realtime service checks (<c>apps/realtime</c>, ADR 0029); change them in both places.
/// </summary>
public sealed partial class HttpVotingNotifier(
    HttpClient http,
    IOptions<RealtimeOptions> realtime,
    IOptions<InternalApiOptions> internalApi,
    TimeProvider time,
    ILogger<HttpVotingNotifier> logger) : IVotingNotifier
{
    public const string Issuer = "elysion-business-backend";
    public const string Audience = "elysion-realtime";
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);

    private static int _warnedAboutMissingUrl;

    public async Task NotifyAsync(Guid boardId,
        string votingEvent,
        VotingBroadcastDto? voting,
        CancellationToken cancellationToken)
    {
        var url = realtime.Value.Url.Trim();
        if (url.Length == 0)
        {
            if (Interlocked.Exchange(ref _warnedAboutMissingUrl, 1) == 0)
            {
                NotConfigured(logger, RealtimeOptions.UrlSetting);
            }

            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                new Uri(new Uri(url), $"/internal/boards/{boardId}/voting"))
            {
                Content = JsonContent.Create(new { @event = votingEvent, voting }),
            };
            request.Headers.Authorization = new("Bearer", Sign());
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(Timeout);
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                Refused(logger, boardId, (int)response.StatusCode);
            }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UriFormatException)
        {
            Failed(logger, boardId, e.GetType().Name);
        }
    }

    private string Sign() => RealtimeServiceToken.Sign(internalApi.Value.Secret, time.GetUtcNow(), Lifetime);

    [LoggerMessage(Level = LogLevel.Warning,
        Message =
            "{Setting} is not set: changes of a voting are not pushed to the other clients, they see them when they reload.")]
    private static partial void NotConfigured(ILogger logger, string setting);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The realtime service refused the news of a voting of board {BoardId} with {Status}.")]
    private static partial void Refused(ILogger logger, Guid boardId, int status);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The realtime service could not be told about a voting of board {BoardId}: {Error}.")]
    private static partial void Failed(ILogger logger, Guid boardId, string error);
}
