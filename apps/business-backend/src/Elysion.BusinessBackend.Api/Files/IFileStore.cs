namespace Elysion.BusinessBackend.Api.Files;

/// <summary>
/// The object store behind the files of boards (ADR 0007). Keys are <c>boards/{boardId}/{fileId}</c>, so everything of
/// a board shares a prefix. Plain S3 operations only, so the store stays replaceable.
/// </summary>
public interface IFileStore
{
    /// <summary>Checks that the store answers and creates the bucket when it is missing. Throws when it cannot.</summary>
    Task EnsureReadyAsync(CancellationToken cancellationToken);

    /// <summary>Stores (or replaces) the object; <paramref name="content"/> is read to its end.</summary>
    Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken);

    /// <summary>The object, or <c>null</c> when there is none. The caller disposes the result.</summary>
    Task<StoredFile?> GetAsync(string key, CancellationToken cancellationToken);

    Task<bool> ExistsAsync(string key, CancellationToken cancellationToken);

    /// <summary>How many objects have a key that starts with <paramref name="prefix"/>.</summary>
    Task<int> CountAsync(string prefix, CancellationToken cancellationToken);

    Task DeletePrefixAsync(string prefix, CancellationToken cancellationToken);

    /// <summary>Copies every object under <paramref name="sourcePrefix"/> to the same name under <paramref name="targetPrefix"/>.</summary>
    Task CopyPrefixAsync(string sourcePrefix, string targetPrefix, CancellationToken cancellationToken);
}

/// <summary>An object being read: its bytes as a stream, and what the store knows about it.</summary>
public sealed class StoredFile(Stream content, string contentType, long length, string? etag) : IAsyncDisposable
{
    public Stream Content { get; } = content;

    public string ContentType { get; } = contentType;

    public long Length { get; } = length;

    public string? ETag { get; } = etag;

    public ValueTask DisposeAsync() => Content.DisposeAsync();
}
