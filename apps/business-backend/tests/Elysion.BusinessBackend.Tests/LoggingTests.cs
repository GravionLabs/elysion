using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Logging;

using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

using Serilog.Core;
using Serilog.Events;
using Serilog.Parsing;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// The logs of the business backend (ADR 0025): one JSON line per request with the shared fields, a request id that is
/// taken, replaced or created and echoed, the subject of the token, the reason a token was refused, and nothing
/// that is a credential.
/// </summary>
public class LoggingTests
{
    private ApiFactory _factory = null!;
    private CapturingSink _sink = null!;

    [SetUp]
    public void SetUp()
    {
        _sink = new CapturingSink();
        _factory = new ApiFactory();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private HttpClient CreateClient(string? token = null)
    {
        var client = _factory
            .WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
                services.AddSingleton<ILogEventSink>(_sink)))
            .CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    private static string Render(LogEvent logEvent)
    {
        using var writer = new StringWriter();
        new ElysionJsonFormatter(RequestLogging.ServiceName).Format(logEvent, writer);
        return writer.ToString();
    }

    private List<JsonDocument> Lines() => _sink.Events.Select(Render).Select(l => JsonDocument.Parse(l)).ToList();

    private static JsonElement RequestLine(IEnumerable<JsonDocument> lines) =>
        lines.Select(l => l.RootElement).Single(l => l.TryGetProperty("http", out _));

    [Test]
    public async Task A_request_without_an_id_gets_one_that_the_response_and_the_request_line_share()
    {
        using var client = CreateClient(ApiFactory.CreateToken("kc-sub-9"));

        var response = await client.GetAsync("/boards");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var id = response.Headers.GetValues(RequestIdMiddleware.HeaderName).Single();
        RequestIdMiddleware.IsValid(id).ShouldBeTrue();
        var line = RequestLine(Lines());
        line.GetProperty("requestId").GetString().ShouldBe(id);
        line.GetProperty("userId").GetString().ShouldBe("kc-sub-9");
        line.GetProperty("service").GetString().ShouldBe("elysion-business-backend");
        line.GetProperty("level").GetString().ShouldBe("info");
        line.GetProperty("timestamp").GetString().ShouldEndWith("Z");
        var http = line.GetProperty("http");
        http.GetProperty("method").GetString().ShouldBe("GET");
        http.GetProperty("route").GetString().ShouldBe("/boards");
        http.GetProperty("status").GetInt32().ShouldBe(200);
        http.GetProperty("durationMs").GetDouble().ShouldBeGreaterThanOrEqualTo(0);
    }

    [Test]
    public async Task A_well_formed_id_of_the_caller_is_kept_and_echoed()
    {
        using var client = CreateClient(ApiFactory.CreateToken());
        using var request = new HttpRequestMessage(HttpMethod.Get, "/boards");
        request.Headers.Add(RequestIdMiddleware.HeaderName, "bff-1234.abcd_EF");

        var response = await client.SendAsync(request);

        response.Headers.GetValues(RequestIdMiddleware.HeaderName).Single().ShouldBe("bff-1234.abcd_EF");
        RequestLine(Lines()).GetProperty("requestId").GetString().ShouldBe("bff-1234.abcd_EF");
    }

    [TestCase("short")]
    [TestCase("has spaces in it 1234")]
    [TestCase("semi;colon;and;more;chars")]
    [TestCase("0123456789012345678901234567890123456789012345678901234567890123456789")] // 70 characters
    public async Task An_id_that_is_not_well_formed_is_replaced_and_never_logged(string sent)
    {
        using var client = CreateClient(ApiFactory.CreateToken());
        using var request = new HttpRequestMessage(HttpMethod.Get, "/boards");
        request.Headers.TryAddWithoutValidation(RequestIdMiddleware.HeaderName, sent);

        var response = await client.SendAsync(request);

        var id = response.Headers.GetValues(RequestIdMiddleware.HeaderName).Single();
        id.ShouldNotBe(sent);
        RequestIdMiddleware.IsValid(id).ShouldBeTrue();
        _sink.Events.Select(Render).ShouldAllBe(l => !l.Contains(sent, StringComparison.Ordinal));
    }

    [Test]
    public async Task Credentials_never_reach_the_output()
    {
        var validToken = ApiFactory.CreateToken("kc-sub-secret");
        using var client = CreateClient(validToken);
        using var request =
            new HttpRequestMessage(HttpMethod.Get, "/boards?token=query-marker&access_token=query-marker-2");
        request.Headers.Add("Cookie", "session=cookie-marker");

        await client.SendAsync(request);
        using var garbage = CreateClient("garbage-marker-token");
        using var rejected = new HttpRequestMessage(HttpMethod.Get, "/boards?token=query-marker");
        rejected.Headers.Add("Cookie", "session=cookie-marker");
        await garbage.SendAsync(rejected);

        var output = string.Join('\n', _sink.Events.Select(Render));
        output.ShouldNotBeEmpty();
        foreach (var secret in new[]
                 {
                     validToken, "garbage-marker-token", "cookie-marker", "query-marker", "query-marker-2",
                     "Bearer garbage", ApiFactory.InternalSecret,
                 })
        {
            output.ShouldNotContain(secret, Case.Sensitive);
        }
    }

    [TestCase("expired", "expired")]
    [TestCase("wrong audience", "wrong_audience")]
    [TestCase("wrong issuer", "wrong_issuer")]
    public async Task A_refused_user_token_logs_the_reason_without_the_token(string kind, string reason)
    {
        var token = kind switch
        {
            "expired" => ApiFactory.CreateToken(lifetime: TimeSpan.FromMinutes(-10)),
            "wrong audience" => ApiFactory.CreateToken(audience: "someone-else"),
            _ => ApiFactory.CreateToken(issuer: "http://evil.test/realms/elysion"),
        };
        using var client = CreateClient(token);

        var response = await client.GetAsync("/boards");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var warning = Lines().Select(l => l.RootElement).Single(l => l.GetProperty("level").GetString() == "warn");
        warning.GetProperty("reason").GetString().ShouldBe(reason);
        warning.GetProperty("scheme").GetString().ShouldBe("Bearer");
        warning.GetProperty("requestId").GetString().ShouldNotBeNullOrEmpty();
        string.Join('\n', _sink.Events.Select(Render)).ShouldNotContain(token);
    }

    [Test]
    public async Task A_wrong_internal_token_says_which_scheme_failed()
    {
        var token = ApiFactory.CreateInternalToken(secret: "another-secret-another-secret-another-secret-0123");
        using var client = CreateClient(token);

        var response = await client.GetAsync("/internal/boards/some-board/document");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var warning = Lines().Select(l => l.RootElement).Single(l => l.GetProperty("level").GetString() == "warn");
        warning.GetProperty("scheme").GetString().ShouldBe(InternalApiOptions.Scheme);
        warning.GetProperty("reason").GetString().ShouldBe("invalid_signature");
        string.Join('\n', _sink.Events.Select(Render)).ShouldNotContain(token);
    }

    [Test]
    public async Task A_missing_internal_token_is_logged_as_missing()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/internal/boards/some-board/document");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var warning = Lines().Select(l => l.RootElement).Single(l => l.GetProperty("level").GetString() == "warn");
        warning.GetProperty("message").GetString()!.ShouldContain("No bearer token");
        warning.GetProperty("scheme").GetString().ShouldBe(InternalApiOptions.Scheme);
    }

    [Test]
    public async Task The_old_framework_lines_are_gone()
    {
        using var client = CreateClient(ApiFactory.CreateToken());

        await client.GetAsync("/boards");

        // One line for the request, nothing from the hosting and routing categories at the default level.
        var categories = _sink.Events
            .Select(e => e.Properties.TryGetValue("SourceContext", out var c) ? c.ToString("l", null) : "")
            .Where(c => c.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal));
        categories.ShouldBeEmpty();
    }

    [Test]
    public void The_json_line_has_the_shared_fields_and_the_exception()
    {
        var events = new LogEvent(
            new DateTimeOffset(2026, 10, 9, 12, 30, 45, 123, TimeSpan.FromHours(2)),
            LogEventLevel.Error,
            new InvalidOperationException("boom"),
            new MessageTemplateParser().Parse("Saving board {BoardId} failed"),
            [
                new LogEventProperty("BoardId", new ScalarValue("b-1")),
                new LogEventProperty(RequestIdMiddleware.PropertyName, new ScalarValue("req-12345678")),
                new LogEventProperty("RequestId", new ScalarValue("0HNtraceid")),
                new LogEventProperty("RequestPath", new ScalarValue("/boards/b-1")),
            ]);

        using var json = JsonDocument.Parse(Render(events));

        var root = json.RootElement;
        root.GetProperty("timestamp").GetString().ShouldBe("2026-10-09T10:30:45.123Z");
        root.GetProperty("level").GetString().ShouldBe("error");
        root.GetProperty("service").GetString().ShouldBe("elysion-business-backend");
        root.GetProperty("requestId").GetString().ShouldBe("req-12345678");
        root.GetProperty("message").GetString().ShouldBe("Saving board b-1 failed");
        root.GetProperty("boardId").GetString().ShouldBe("b-1");
        root.GetProperty("err").GetProperty("type").GetString().ShouldBe("System.InvalidOperationException");
        root.GetProperty("err").GetProperty("message").GetString().ShouldBe("boom");
        root.TryGetProperty("RequestId", out _).ShouldBeFalse(); // the hosting scope's trace id is not the request id
        root.TryGetProperty("requestPath", out _).ShouldBeFalse();
    }

    [Test]
    public void A_message_reads_without_the_quotes_serilog_puts_around_strings_and_keeps_other_formats()
    {
        var line = new LogEvent(
            DateTimeOffset.UtcNow,
            LogEventLevel.Information,
            null,
            new MessageTemplateParser().Parse("HTTP {Method} {Route} took {Elapsed:0.0} ms for {Count}"),
            [
                new LogEventProperty("Method", new ScalarValue("GET")),
                new LogEventProperty("Route", new ScalarValue("/boards/{id}")),
                new LogEventProperty("Elapsed", new ScalarValue(12.345)),
                new LogEventProperty("Count", new ScalarValue(3)),
            ]);

        ElysionJsonFormatter.RenderMessage(line).ShouldBe("HTTP GET /boards/{id} took 12.3 ms for 3");
        Render(line).ShouldContain("\"message\":\"HTTP GET /boards/{id} took 12.3 ms for 3\"");
    }

    [TestCase(LogEventLevel.Verbose, "trace")]
    [TestCase(LogEventLevel.Debug, "debug")]
    [TestCase(LogEventLevel.Information, "info")]
    [TestCase(LogEventLevel.Warning, "warn")]
    [TestCase(LogEventLevel.Error, "error")]
    [TestCase(LogEventLevel.Fatal, "fatal")]
    public void The_level_uses_the_words_of_all_three_services(LogEventLevel level, string expected) =>
        ElysionJsonFormatter.LevelName(level).ShouldBe(expected);

    private sealed class CapturingSink : ILogEventSink
    {
        private readonly ConcurrentQueue<LogEvent> _events = new();

        public IReadOnlyCollection<LogEvent> Events => _events;

        public void Emit(LogEvent logEvent) => _events.Enqueue(logEvent);
    }
}
