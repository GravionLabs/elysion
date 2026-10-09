using System.Collections.Concurrent;

namespace Elysion.BusinessBackend.Api.Files;

/// <summary>An <see cref="IFileStore"/> in memory, for the tests (the S3 one needs a running store).</summary>
public sealed class InMemoryFileStore : IFileStore
{
    private readonly ConcurrentDictionary<string, (byte[] Bytes, string ContentType)> _objects = new();

    public IReadOnlyCollection<string> Keys => _objects.Keys.ToList();

    public Task EnsureReadyAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, cancellationToken);
        _objects[key] = (buffer.ToArray(), contentType);
    }

    public Task<StoredFile?> GetAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(_objects.TryGetValue(key, out var found)
            ? new StoredFile(new MemoryStream(found.Bytes, false),
                found.ContentType,
                found.Bytes.Length,
                $"\"{key.GetHashCode():x}\"")
            : null);

    public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(_objects.ContainsKey(key));

    public Task<int> CountAsync(string prefix, CancellationToken cancellationToken) =>
        Task.FromResult(_objects.Keys.Count(key => key.StartsWith(prefix, StringComparison.Ordinal)));

    public Task DeletePrefixAsync(string prefix, CancellationToken cancellationToken)
    {
        foreach (var key in _objects.Keys.Where(key => key.StartsWith(prefix, StringComparison.Ordinal)))
        {
            _objects.TryRemove(key, out _);
        }

        return Task.CompletedTask;
    }

    public Task CopyPrefixAsync(string sourcePrefix, string targetPrefix, CancellationToken cancellationToken)
    {
        foreach (var (key, value) in _objects.Where(pair => pair.Key.StartsWith(sourcePrefix, StringComparison.Ordinal))
                     .ToList())
        {
            _objects[targetPrefix + key[sourcePrefix.Length..]] = value;
        }

        return Task.CompletedTask;
    }
}
