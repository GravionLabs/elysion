using Amazon.Runtime;

namespace Elysion.BusinessBackend.Api.Files;

public static class FileStorageExtensions
{
    /// <summary>
    /// The object store of board files: its settings are validated at start, and the bucket is created and checked
    /// before the service takes requests, so a wrong endpoint or key fails the start and not the first upload.
    /// </summary>
    public static IServiceCollection AddElysionFileStorage(this IServiceCollection services)
    {
        services.AddOptions<FileOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                options.Endpoint = configuration[FileOptions.EndpointSetting] ?? "";
                options.Bucket = configuration[FileOptions.BucketSetting] ?? FileOptions.DefaultBucket;
                options.AccessKey = configuration[FileOptions.AccessKeySetting] ?? "";
                options.SecretKey = configuration[FileOptions.SecretKeySetting] ?? "";
                options.MaxFileBytes =
                    configuration.GetValue(FileOptions.MaxFileBytesSetting, FileOptions.DefaultMaxFileBytes);
                options.MaxFilesPerBoard =
                    configuration.GetValue(FileOptions.MaxFilesPerBoardSetting, FileOptions.DefaultMaxFilesPerBoard);
            })
            .ValidateDataAnnotations()
            .ValidateOnStart();
        services.AddSingleton<IFileStore, S3FileStore>();
        services.AddHostedService<FileStoreStartupCheck>();
        return services;
    }
}

/// <summary>
/// Waits for the object store at start (it may come up a little after this service in a compose stack) and
/// gives up loudly, which stops the host.
/// </summary>
public sealed partial class FileStoreStartupCheck(IFileStore store, ILogger<FileStoreStartupCheck> logger)
    : IHostedService
{
    private const int Attempts = 10;
    private static readonly TimeSpan Delay = TimeSpan.FromSeconds(3);

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 1;; attempt++)
        {
            try
            {
                await store.EnsureReadyAsync(cancellationToken);
                return;
            }
            catch (Exception e) when (e is AmazonServiceException or HttpRequestException
                                      && attempt < Attempts)
            {
                NotReady(logger, attempt, Attempts, e.Message);
                await Task.Delay(Delay, cancellationToken);
            }
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "The file store is not ready (attempt {Attempt} of {Attempts}): {Reason}")]
    private static partial void NotReady(ILogger logger, int attempt, int attempts, string reason);
}
