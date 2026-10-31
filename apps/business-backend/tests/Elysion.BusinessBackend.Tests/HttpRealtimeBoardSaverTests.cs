using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Text;

using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Snapshots;
using Elysion.BusinessBackend.Api.Voting;

using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The call from "Save version" to the realtime service's internal save route (ADR 0032).</summary>
public class HttpRealtimeBoardSaverTests
{
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return respond(request);
        }
    }

    private static readonly Guid Board = Guid.NewGuid();

    private static HttpRealtimeBoardSaver Saver(Handler handler, string url = "http://realtime.test:3000/") =>
        new(new HttpClient(handler),
            Options.Create(new RealtimeOptions { Url = url }),
            Options.Create(new InternalApiOptions { Secret = ApiFactory.InternalSecret }),
            TimeProvider.System,
            NullLogger<HttpRealtimeBoardSaver>.Instance);

    [Test]
    public async Task Posts_to_the_save_route_of_the_board_with_a_signed_service_token()
    {
        var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent)));

        await Saver(handler).SaveNowAsync(Board, CancellationToken.None);

        var request = handler.Requests.ShouldHaveSingleItem();
        request.Method.ShouldBe(HttpMethod.Post);
        request.RequestUri!.ToString().ShouldBe($"http://realtime.test:3000/internal/boards/{Board}/save");
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
    public async Task Without_a_realtime_url_nothing_is_sent()
    {
        var handler = new Handler(_ => throw new InvalidOperationException("must not be called"));

        await Saver(handler, "").SaveNowAsync(Board, CancellationToken.None);

        handler.Requests.ShouldBeEmpty();
    }

    [Test]
    public async Task A_refusal_an_unreachable_service_and_a_timeout_are_not_errors_for_the_caller()
    {
        var refused = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        var down = new Handler(_ => throw new HttpRequestException("connection refused"));
        var slow = new Handler(_ => throw new TaskCanceledException("timed out"));

        await Should.NotThrowAsync(() => Saver(refused).SaveNowAsync(Board, CancellationToken.None));
        await Should.NotThrowAsync(() => Saver(down).SaveNowAsync(Board, CancellationToken.None));
        await Should.NotThrowAsync(() => Saver(slow).SaveNowAsync(Board, CancellationToken.None));
    }

    [Test]
    public async Task A_cancelled_request_still_cancels()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var handler = new Handler(_ => throw new OperationCanceledException(cancelled.Token));

        await Should.ThrowAsync<OperationCanceledException>(() => Saver(handler).SaveNowAsync(Board, cancelled.Token));
    }
}
