using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>A webhook receiver on the loopback address for the tests: it records what it gets and answers <see cref="Status"/>.</summary>
public sealed class LocalReceiver : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _stop = new();

    public LocalReceiver()
    {
        Port = FreePort();
        _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        _listener.Start();
        _ = Task.Run(LoopAsync);
    }

    public int Port { get; }

    public string Url(string path = "/hook") => $"http://127.0.0.1:{Port}{path}";

    /// <summary>What the receiver answers; a 3xx carries <see cref="Location"/>.</summary>
    public int Status { get; set; } = 200;

    public string? Location { get; set; }

    public ConcurrentQueue<Received> Requests { get; } = new();

    public sealed record Received(string Method, string Path, IReadOnlyDictionary<string, string> Headers, string Body);

    private async Task LoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync();
            }
            catch (Exception) when (_stop.IsCancellationRequested)
            {
                return;
            }
            catch (HttpListenerException)
            {
                return;
            }

            using var reader = new StreamReader(context.Request.InputStream);
            var body = await reader.ReadToEndAsync();
            var headers = context.Request.Headers.AllKeys
                .Where(k => k is not null)
                .ToDictionary(k => k!, k => context.Request.Headers[k] ?? "", StringComparer.OrdinalIgnoreCase);
            Requests.Enqueue(new Received(context.Request.HttpMethod,
                context.Request.Url!.PathAndQuery,
                headers,
                body));
            context.Response.StatusCode = Status;
            if (Location is not null)
            {
                context.Response.Headers["Location"] = Location;
            }

            context.Response.Close();
        }
    }

    private static int FreePort()
    {
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        return ((IPEndPoint)probe.LocalEndpoint).Port;
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Close();
        _stop.Dispose();
    }
}
