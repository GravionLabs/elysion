using System.Net;

using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Util;

using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Files;

/// <summary>
/// <see cref="IFileStore"/> against an S3 API with path-style addressing (RustFS, MinIO, Garage and AWS all take it).
/// </summary>
public sealed partial class S3FileStore : IFileStore, IDisposable
{
    private readonly AmazonS3Client _s3;
    private readonly string _bucket;
    private readonly ILogger<S3FileStore> _logger;

    public S3FileStore(IOptions<FileOptions> options, ILogger<S3FileStore> logger)
    {
        var settings = options.Value;
        _bucket = settings.Bucket;
        _logger = logger;
        _s3 = new AmazonS3Client(
            new Amazon.Runtime.BasicAWSCredentials(settings.AccessKey, settings.SecretKey),
            new AmazonS3Config
            {
                ServiceURL = settings.Endpoint,
                ForcePathStyle = true,
                // RustFS signs for any region; the SDK needs one when a service URL is set.
                AuthenticationRegion = "us-east-1",
                // Checksums of the newer SDKs are not understood by every S3 clone: send them only when required.
                RequestChecksumCalculation = Amazon.Runtime.RequestChecksumCalculation.WHEN_REQUIRED,
                ResponseChecksumValidation = Amazon.Runtime.ResponseChecksumValidation.WHEN_REQUIRED,
            });
    }

    public void Dispose() => _s3.Dispose();

    public async Task EnsureReadyAsync(CancellationToken cancellationToken)
    {
        if (!await AmazonS3Util.DoesS3BucketExistV2Async(_s3, _bucket))
        {
            await _s3.PutBucketAsync(new PutBucketRequest { BucketName = _bucket }, cancellationToken);
            BucketCreated(_logger, _bucket);
        }

        // The bucket answers a list: the credentials may read it, which is what every request needs.
        await _s3.ListObjectsV2Async(
            new ListObjectsV2Request { BucketName = _bucket, MaxKeys = 1 },
            cancellationToken);
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken) =>
        await _s3.PutObjectAsync(
            new PutObjectRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = content,
                ContentType = contentType,
                AutoCloseStream = false,
                // Plain HTTP inside the compose network: sign the payload as one piece, not as a signed stream.
                UseChunkEncoding = false,
            },
            cancellationToken);

    public async Task<StoredFile?> GetAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            var response = await _s3.GetObjectAsync(_bucket, key, cancellationToken);
            return new StoredFile(response.ResponseStream,
                response.Headers.ContentType,
                response.ContentLength,
                response.ETag);
        }
        catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, key, cancellationToken);
            return true;
        }
        catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    public async Task<int> CountAsync(string prefix, CancellationToken cancellationToken) =>
        (await ListAsync(prefix, cancellationToken)).Count;

    public async Task DeletePrefixAsync(string prefix, CancellationToken cancellationToken)
    {
        var keys = await ListAsync(prefix, cancellationToken);
        // DeleteObjects takes 1,000 keys at most.
        foreach (var batch in keys.Chunk(1000))
        {
            await _s3.DeleteObjectsAsync(
                new DeleteObjectsRequest
                {
                    BucketName = _bucket, Objects = batch.Select(key => new KeyVersion { Key = key }).ToList(),
                },
                cancellationToken);
        }
    }

    public async Task CopyPrefixAsync(string sourcePrefix, string targetPrefix, CancellationToken cancellationToken)
    {
        foreach (var key in await ListAsync(sourcePrefix, cancellationToken))
        {
            await _s3.CopyObjectAsync(
                _bucket,
                key,
                _bucket,
                targetPrefix + key[sourcePrefix.Length..],
                cancellationToken);
        }
    }

    private async Task<List<string>> ListAsync(string prefix, CancellationToken cancellationToken)
    {
        var keys = new List<string>();
        var request = new ListObjectsV2Request { BucketName = _bucket, Prefix = prefix };
        ListObjectsV2Response response;
        do
        {
            response = await _s3.ListObjectsV2Async(request, cancellationToken);
            keys.AddRange((response.S3Objects ?? []).Select(o => o.Key));
            request.ContinuationToken = response.NextContinuationToken;
        } while (response.IsTruncated == true);

        return keys;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Created the bucket {Bucket} of the file store")]
    private static partial void BucketCreated(ILogger logger, string bucket);
}
