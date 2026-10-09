using System.ComponentModel.DataAnnotations;

namespace Elysion.BusinessBackend.Api.Files;

/// <summary>
/// Where the files of boards are stored (an S3-compatible store, RustFS in the stack, ADR 0007) and how much of
/// them a board may hold. Bound from configuration under the names of the other services' variables.
/// </summary>
public sealed class FileOptions
{
    public const string EndpointSetting = "S3_ENDPOINT";
    public const string BucketSetting = "S3_BUCKET";
    public const string AccessKeySetting = "S3_ACCESS_KEY";
    public const string SecretKeySetting = "S3_SECRET_KEY";
    public const string MaxFileBytesSetting = "MAX_FILE_BYTES";
    public const string MaxFilesPerBoardSetting = "MAX_FILES_PER_BOARD";

    public const string DefaultBucket = "elysion-files";
    public const long DefaultMaxFileBytes = 10 * 1024 * 1024;
    public const int DefaultMaxFilesPerBoard = 200;

    /// <summary>The S3 API, e.g. <c>http://rustfs:9000</c>. Required: without it the service does not start.</summary>
    [Required, Url]
    public string Endpoint { get; set; } = "";

    /// <summary>Created at start when it does not exist.</summary>
    [Required]
    public string Bucket { get; set; } = DefaultBucket;

    [Required]
    public string AccessKey { get; set; } = "";

    [Required]
    public string SecretKey { get; set; } = "";

    [Range(1, 1024L * 1024 * 1024)]
    public long MaxFileBytes { get; set; } = DefaultMaxFileBytes;

    [Range(1, 100_000)]
    public int MaxFilesPerBoard { get; set; } = DefaultMaxFilesPerBoard;
}
