using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Voting;

using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Snapshots;

/// <summary>Asks the realtime service to store a board's open state now, so that "Save version" holds the last seconds too (ADR 0032).</summary>
public interface IRealtimeBoardSaver
{
    /// <summary>Best effort: returns normally whether the board was open, the service is not configured, refused, or did not answer.</summary>
    Task SaveNowAsync(Guid boardId, CancellationToken cancellationToken);
}

/// <summary>
/// Posts to <c>{REALTIME_URL}/internal/boards/{boardId}/save</c> with the same service token as <see cref="HttpVotingNotifier"/>.
/// Never throws because of the call: a snapshot of the stored state is better than no snapshot.
/// </summary>
public sealed partial class HttpRealtimeBoardSaver(
    HttpClient http,
    IOptions<RealtimeOptions> realtime,
    IOptions<InternalApiOptions> internalApi,
    TimeProvider time,
    ILogger<HttpRealtimeBoardSaver> logger) : IRealtimeBoardSaver
{
    /// <summary>The realtime service's own save has to reach the backend within this.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    public async Task SaveNowAsync(Guid boardId, CancellationToken cancellationToken)
    {
        var url = realtime.Value.Url.Trim();
        if (url.Length == 0)
        {
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                new Uri(new Uri(url), $"/internal/boards/{boardId}/save"));
            request.Headers.Authorization = new("Bearer",
                RealtimeServiceToken.Sign(internalApi.Value.Secret, time.GetUtcNow(), HttpVotingNotifier.Lifetime));
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(Timeout);
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                Refused(logger, boardId, (int)response.StatusCode);
            }
        }
        catch (Exception e) when (e is HttpRequestException or UriFormatException
                                  || (e is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            Failed(logger, boardId, e.GetType().Name);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The realtime service refused to save board {BoardId} before a version with {Status}.")]
    private static partial void Refused(ILogger logger, Guid boardId, int status);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The realtime service could not be asked to save board {BoardId} before a version: {Error}.")]
    private static partial void Failed(ILogger logger, Guid boardId, string error);
}
