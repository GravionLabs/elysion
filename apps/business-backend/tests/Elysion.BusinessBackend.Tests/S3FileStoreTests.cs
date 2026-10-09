using Elysion.BusinessBackend.Api.Files;

using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// The S3 implementation against a real S3 API. Runs only when <c>ELYSION_TEST_S3_ENDPOINT</c> is set (RustFS from
/// <c>pnpm dev:infra</c> is <c>http://localhost:9100</c>, with the keys of the dev stack); the container workflow covers it
/// through the stack otherwise.
/// </summary>
public class S3FileStoreTests
{
    private S3FileStore _store = null!;
    private string _prefix = null!;

    [SetUp]
    public void SetUp()
    {
        var endpoint = Environment.GetEnvironmentVariable("ELYSION_TEST_S3_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint))
        {
            Assert.Ignore("ELYSION_TEST_S3_ENDPOINT is not set.");
        }

        _store = new S3FileStore(
            Options.Create(new Api.Files.FileOptions
            {
                Endpoint = endpoint!,
                Bucket = "elysion-files-test",
                AccessKey = Environment.GetEnvironmentVariable("ELYSION_TEST_S3_ACCESS_KEY") ?? "elysion",
                SecretKey = Environment.GetEnvironmentVariable("ELYSION_TEST_S3_SECRET_KEY") ?? "elysion123",
            }),
            NullLogger<S3FileStore>.Instance);
        _prefix = $"boards/{Guid.NewGuid()}/";
    }

    [TearDown]
    public async Task TearDown()
    {
        if (_store is not null)
        {
            await _store.DeletePrefixAsync(_prefix, CancellationToken.None);
            _store.Dispose();
        }
    }

    [Test]
    public async Task Put_get_count_copy_and_delete_work_against_the_store()
    {
        await _store.EnsureReadyAsync(CancellationToken.None);
        await _store.EnsureReadyAsync(CancellationToken.None); // a second start finds the bucket

        var bytes = new byte[300_000];
        Random.Shared.NextBytes(bytes);
        await _store.PutAsync(_prefix + "a", new MemoryStream(bytes), "image/png", CancellationToken.None);
        await _store.PutAsync(_prefix + "b", new MemoryStream([1, 2, 3]), "image/gif", CancellationToken.None);

        (await _store.ExistsAsync(_prefix + "a", CancellationToken.None)).ShouldBeTrue();
        (await _store.ExistsAsync(_prefix + "zzz", CancellationToken.None)).ShouldBeFalse();
        (await _store.CountAsync(_prefix, CancellationToken.None)).ShouldBe(2);
        await using (var file = await _store.GetAsync(_prefix + "a", CancellationToken.None))
        {
            file.ShouldNotBeNull();
            file.ContentType.ShouldBe("image/png");
            file.Length.ShouldBe(bytes.Length);
            using var read = new MemoryStream();
            await file.Content.CopyToAsync(read);
            read.ToArray().ShouldBe(bytes);
        }

        (await _store.GetAsync(_prefix + "missing", CancellationToken.None)).ShouldBeNull();

        var copy = $"boards/{Guid.NewGuid()}/";
        try
        {
            await _store.CopyPrefixAsync(_prefix, copy, CancellationToken.None);
            (await _store.CountAsync(copy, CancellationToken.None)).ShouldBe(2);
            (await _store.ExistsAsync(copy + "b", CancellationToken.None)).ShouldBeTrue();
        }
        finally
        {
            await _store.DeletePrefixAsync(copy, CancellationToken.None);
        }

        await _store.DeletePrefixAsync(_prefix, CancellationToken.None);
        (await _store.CountAsync(_prefix, CancellationToken.None)).ShouldBe(0);
    }
}
