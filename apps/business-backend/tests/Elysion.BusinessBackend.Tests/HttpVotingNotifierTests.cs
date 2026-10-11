using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Voting;

using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The call from the backend to the realtime service's internal route (ADR 0029).</summary>
public class HttpVotingNotifierTests
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

    private static VotingBroadcastDto Voting() => new(Guid.NewGuid(),
        "V",
        3,
        "open",
        false,
        new VotingPersonDto("s", "S"),
        DateTimeOffset.UtcNow,
        null,
        new Dictionary<string, int> { ["s"] = 1 },
        null);

    private static HttpVotingNotifier Notifier(Handler handler, string url = "http://realtime.test:3000/") =>
        new(new HttpClient(handler),
            Options.Create(new RealtimeOptions { Url = url }),
            Options.Create(new InternalApiOptions { Secret = ApiFactory.InternalSecret }),
            TimeProvider.System,
            NullLogger<HttpVotingNotifier>.Instance);

    [Test]
    public async Task Posts_the_event_and_the_voting_with_a_signed_one_minute_token()
    {
        var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent)));

        await Notifier(handler).NotifyAsync(Board, VotingEvents.Vote, Voting(), CancellationToken.None);

        var (request, body) = handler.Requests.ShouldHaveSingleItem();
        request.Method.ShouldBe(HttpMethod.Post);
        request.RequestUri!.ToString().ShouldBe($"http://realtime.test:3000/internal/boards/{Board}/voting");
        using var json = JsonDocument.Parse(body);
        json.RootElement.GetProperty("event").GetString().ShouldBe("vote");
        json.RootElement.GetProperty("voting").GetProperty("votesPerPerson").GetInt32().ShouldBe(3);
        json.RootElement.GetProperty("voting").TryGetProperty("myVotes", out _).ShouldBeFalse();

        var token = request.Headers.Authorization!.Parameter!;
        var principal = new JwtSecurityTokenHandler().ValidateToken(token,
            new TokenValidationParameters
            {
                ValidIssuer = HttpVotingNotifier.Issuer,
                ValidAudience = HttpVotingNotifier.Audience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(ApiFactory.InternalSecret)),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            },
            out var validated);
        principal.ShouldNotBeNull();
        (validated.ValidTo - validated.ValidFrom).ShouldBeLessThanOrEqualTo(TimeSpan.FromSeconds(61));
    }

    [Test]
    public async Task Without_a_realtime_url_nothing_is_sent()
    {
        var handler = new Handler(_ => throw new InvalidOperationException("must not be called"));

        await Notifier(handler, "").NotifyAsync(Board, VotingEvents.Start, Voting(), CancellationToken.None);

        handler.Requests.ShouldBeEmpty();
    }

    [Test]
    public async Task A_refusal_or_an_unreachable_service_is_not_an_error_for_the_caller()
    {
        var refused = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        var down = new Handler(_ => throw new HttpRequestException("connection refused"));

        await Notifier(refused).NotifyAsync(Board, VotingEvents.Close, Voting(), CancellationToken.None);
        await Notifier(down).NotifyAsync(Board, VotingEvents.Close, Voting(), CancellationToken.None);

        refused.Requests.Count.ShouldBe(1);
        down.Requests.Count.ShouldBe(1);
    }

    [Test]
    public async Task A_clear_sends_a_null_voting()
    {
        var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent)));

        await Notifier(handler).NotifyAsync(Board, VotingEvents.Clear, null, CancellationToken.None);

        handler.Requests.Single().Body.ShouldContain("\"voting\":null");
    }
}
