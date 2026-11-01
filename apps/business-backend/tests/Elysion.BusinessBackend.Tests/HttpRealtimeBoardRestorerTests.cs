using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Snapshots;
using Elysion.BusinessBackend.Api.Voting;

using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The call from "Restore" to the realtime service's internal restore route (ADR 0032, #847).</summary>
public class HttpRealtimeBoardRestorerTests
{
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add((request,
                request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            return await respond(request);
        }
    }

    private static readonly Guid Board = Guid.NewGuid();
    private static readonly Guid Snapshot = Guid.NewGuid();
    private static readonly DateTimeOffset At = new(2026, 10, 31, 10, 0, 0, TimeSpan.Zero);

    private static HttpRealtimeBoardRestorer Restorer(Handler handler, string url = "http://realtime.test:3000/") =>
        new(new HttpClient(handler),
            Options.Create(new RealtimeOptions { Url = url }),
            Options.Create(new InternalApiOptions { Secret = ApiFactory.InternalSecret }),
            TimeProvider.System,
            NullLogger<HttpRealtimeBoardRestorer>.Instance);

    private static Task<RealtimeRestoreStatus> Restore(HttpRealtimeBoardRestorer restorer) =>
        restorer.RestoreAsync(Board, Snapshot, "Ada", At, CancellationToken.None);

    [Test]
    public async Task Posts_the_version_the_person_and_the_time_with_a_signed_service_token()
    {
        var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent)));

        (await Restore(Restorer(handler))).ShouldBe(RealtimeRestoreStatus.Restored);

        var (request, body) = handler.Requests.ShouldHaveSingleItem();
        request.Method.ShouldBe(HttpMethod.Post);
        request.RequestUri!.ToString().ShouldBe($"http://realtime.test:3000/internal/boards/{Board}/restore");
        var json = JsonDocument.Parse(body).RootElement;
        json.GetProperty("snapshotId").GetGuid().ShouldBe(Snapshot);
        json.GetProperty("by").GetString().ShouldBe("Ada");
        json.GetProperty("at").GetDateTimeOffset().ShouldBe(At);
        new JwtSecurityTokenHandler().ValidateToken(request.Headers.Authorization!.Parameter!,
                new TokenValidationParameters
                {
                    ValidIssuer = "elysion-business-backend",
                    ValidAudience = "elysion-realtime",
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(ApiFactory.InternalSecret)),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                },
                out _)
            .ShouldNotBeNull();
    }

    [Test]
    public async Task A_404_means_the_version_is_missing_and_other_failures_mean_unavailable()
    {
        var missing = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound)));
        var refused = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        var broken = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError)));
        var down = new Handler(_ => throw new HttpRequestException("connection refused"));
        var slow = new Handler(_ => throw new TaskCanceledException("timed out"));

        (await Restore(Restorer(missing))).ShouldBe(RealtimeRestoreStatus.SnapshotMissing);
        (await Restore(Restorer(refused))).ShouldBe(RealtimeRestoreStatus.Unavailable);
        (await Restore(Restorer(broken))).ShouldBe(RealtimeRestoreStatus.Unavailable);
        (await Restore(Restorer(down))).ShouldBe(RealtimeRestoreStatus.Unavailable);
        (await Restore(Restorer(slow))).ShouldBe(RealtimeRestoreStatus.Unavailable);
    }

    [Test]
    public async Task Without_a_realtime_url_nothing_is_sent_and_the_restore_is_unavailable()
    {
        var handler = new Handler(_ => throw new InvalidOperationException("must not be called"));

        (await Restore(Restorer(handler, ""))).ShouldBe(RealtimeRestoreStatus.Unavailable);

        handler.Requests.ShouldBeEmpty();
    }

    [Test]
    public async Task A_cancelled_request_still_cancels()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var handler = new Handler(_ => throw new OperationCanceledException(cancelled.Token));

        await Should.ThrowAsync<OperationCanceledException>(() =>
            Restorer(handler).RestoreAsync(Board, Snapshot, "Ada", At, cancelled.Token));
    }
}
