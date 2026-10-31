using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Voting;

using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Snapshots;

/// <summary>How the realtime service answered a restore.</summary>
public enum RealtimeRestoreStatus
{
    Restored,

    /// <summary>The service could not read the version from the backend.</summary>
    SnapshotMissing,

    /// <summary>The service is not configured, did not answer or failed: the board has not been restored.</summary>
    Unavailable,
}

/// <summary>Asks the realtime service to restore a version onto a board and tell its clients (ADR 0032, #847).</summary>
public interface IRealtimeBoardRestorer
{
    /// <param name="by">The display name of the person, shown to the board: "&lt;by&gt; restored the version of &lt;time&gt;".</param>
    /// <param name="at">When the version was made.</param>
    Task<RealtimeRestoreStatus> RestoreAsync(
        Guid boardId,
        Guid snapshotId,
        string by,
        DateTimeOffset at,
        CancellationToken cancellationToken);
}

/// <summary>
/// Posts to <c>{REALTIME_URL}/internal/boards/{boardId}/restore</c> with the same service token as
/// <see cref="HttpVotingNotifier"/>. Unlike the notification it must succeed: a restore that did not reach the board is an error.
/// </summary>
public sealed partial class HttpRealtimeBoardRestorer(
    HttpClient http,
    IOptions<RealtimeOptions> realtime,
    IOptions<InternalApiOptions> internalApi,
    TimeProvider time,
    ILogger<HttpRealtimeBoardRestorer> logger) : IRealtimeBoardRestorer
{
    /// <summary>The service reads the version, merges it, and stores the board before it answers.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    public async Task<RealtimeRestoreStatus> RestoreAsync(
        Guid boardId,
        Guid snapshotId,
        string by,
        DateTimeOffset at,
        CancellationToken cancellationToken)
    {
        var url = realtime.Value.Url.Trim();
        if (url.Length == 0)
        {
            NotConfigured(logger, RealtimeOptions.UrlSetting);
            return RealtimeRestoreStatus.Unavailable;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                new Uri(new Uri(url), $"/internal/boards/{boardId}/restore"))
            {
                Content = JsonContent.Create(new { snapshotId, by, at }),
            };
            request.Headers.Authorization = new("Bearer",
                RealtimeServiceToken.Sign(internalApi.Value.Secret, time.GetUtcNow(), HttpVotingNotifier.Lifetime));
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(Timeout);
            using var response = await http.SendAsync(request, timeout.Token);
            if (response.IsSuccessStatusCode)
            {
                return RealtimeRestoreStatus.Restored;
            }

            Refused(logger, boardId, (int)response.StatusCode);
            return response.StatusCode == System.Net.HttpStatusCode.NotFound
                ? RealtimeRestoreStatus.SnapshotMissing
                : RealtimeRestoreStatus.Unavailable;
        }
        catch (Exception e) when (e is HttpRequestException or UriFormatException
                                  || (e is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            Failed(logger, boardId, e.GetType().Name);
            return RealtimeRestoreStatus.Unavailable;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "{Setting} is not set, so no board can be restored.")]
    private static partial void NotConfigured(ILogger logger, string setting);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The realtime service refused to restore board {BoardId} with {Status}.")]
    private static partial void Refused(ILogger logger, Guid boardId, int status);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The realtime service could not be asked to restore board {BoardId}: {Error}.")]
    private static partial void Failed(ILogger logger, Guid boardId, string error);
}
