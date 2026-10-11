using System.Net;
using System.Text;
using System.Text.Json;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>A TimeProvider whose timers fire at once, so that a test of a <c>Retry-After</c> does not wait.</summary>
internal sealed class ImmediateTimeProvider : TimeProvider
{
    public List<TimeSpan> Waits { get; } = [];

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        Waits.Add(dueTime);
        ThreadPool.QueueUserWorkItem(_ => callback(state));
        return new NoTimer();
    }

    private sealed class NoTimer : ITimer
    {
        public bool Change(TimeSpan dueTime, TimeSpan period) => true;
        public void Dispose() { }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

/// <summary>
/// A directory in a delegate: the token endpoint and Graph, as far as the sync uses them. Every request is recorded; a route is the
/// path and query as the client asked for them.
/// </summary>
internal sealed class FakeGraphHandler(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];
    public List<string> Bodies { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        Requests.Add(request);
        Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
        return answer(request);
    }

    public static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    public static HttpResponseMessage Token(string value = "graph-token") =>
        Json(new { access_token = value, expires_in = 3600, token_type = "Bearer" });
}
