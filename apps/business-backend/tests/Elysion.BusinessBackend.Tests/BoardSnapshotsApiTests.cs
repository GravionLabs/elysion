using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Files;
using Elysion.BusinessBackend.Api.Snapshots;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The versions of a board, made on request and on the saves of the realtime service (ADR 0032, #846).</summary>
public class BoardSnapshotsApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private MutableTime _time = null!;
    private Board _board = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _time = new MutableTime(Start);
        _factory = new ApiFactory(_time);
        foreach (var name in new[] { "owner", "editor", "viewer", "stranger" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, $"{name}", $"{name}@example.com", Start);
        }

        _board = Board.Create(Guid.CreateVersion7(), "Retro", Start, _users["owner"].Id);
        await InDb(db =>
        {
            db.AddRange(_users.Values);
            db.AddRange(
                _board,
                BoardMembership.Create(_board.Id, _users["owner"].Id, BoardRole.Owner, Start),
                BoardMembership.Create(_board.Id, _users["editor"].Id, BoardRole.Editor, Start),
                BoardMembership.Create(_board.Id, _users["viewer"].Id, BoardRole.Viewer, Start));
            return Task.CompletedTask;
        });
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private async Task InDb(Func<ElysionDbContext, Task> action)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        await action(db);
        await db.SaveChangesAsync();
    }

    private async Task<T> Query<T>(Func<ElysionDbContext, Task<T>> query)
    {
        using var scope = _factory.Services.CreateScope();
        return await query(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    private HttpClient As(string name) =>
        _factory.CreateAuthenticatedClient(name,
        [
            new System.Security.Claims.Claim("sub", name), new("email", $"{name}@example.com"),
            new("preferred_username", name)
        ]);

    private string Url(string suffix = "") => $"/boards/{_board.Id}/snapshots{suffix}";

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    /// <summary>Saves a state the way the realtime service does.</summary>
    private async Task<HttpResponseMessage> SaveDocumentAsync(byte[] state,
        long? version = null,
        string? reason = null,
        int? elements = null)
    {
        using var realtime = _factory.CreateInternalClient();
        var request = new HttpRequestMessage(HttpMethod.Put, $"/internal/boards/{_board.Id}/document")
        {
            Content = new ByteArrayContent(state)
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        if (version is null)
            request.Headers.TryAddWithoutValidation("If-None-Match", "*");
        else
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        if (reason is not null)
            request.Headers.TryAddWithoutValidation(BoardDocumentEndpointsHeaders.SaveReason, reason);
        if (elements is not null)
            request.Headers.TryAddWithoutValidation(BoardDocumentEndpointsHeaders.ElementCount,
                elements.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return await realtime.SendAsync(request);
    }

    private async Task<SnapshotDto[]> ListAsync(string who = "owner")
    {
        using var client = As(who);
        return (await client.GetFromJsonAsync<SnapshotDto[]>(Url()))!;
    }

    private static async Task<byte[]> UngzipAsync(byte[] gz)
    {
        await using var input = new GZipStream(new MemoryStream(gz), CompressionMode.Decompress);
        using var output = new MemoryStream();
        await input.CopyToAsync(output);
        return output.ToArray();
    }

    private async Task<SnapshotDto> SaveVersionAsync(string? name = "Before the workshop", string who = "owner")
    {
        using var client = As(who);
        var response = await client.PostAsync(Url(), Json(new { name }));
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<SnapshotDto>())!;
    }

    [Test]
    public async Task Save_version_keeps_the_stored_state_gzipped_and_names_its_author()
    {
        (await SaveDocumentAsync([1, 2, 3, 4])).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var created = await SaveVersionAsync("  Before the workshop ", "editor");

        created.Name.ShouldBe("Before the workshop");
        created.Kind.ShouldBe("Manual");
        created.Author.ShouldBe("editor");
        created.CreatedAt.ShouldBe(Start);
        var key = FileTypes.SnapshotKey(_board.Id, created.Id);
        _factory.Files.Keys.ShouldBe([key]);
        await using var stored = await _factory.Files.GetAsync(key, CancellationToken.None);
        using var bytes = new MemoryStream();
        await stored!.Content.CopyToAsync(bytes);
        (await UngzipAsync(bytes.ToArray())).ShouldBe(new byte[] { 1, 2, 3, 4 });
        created.SizeBytes.ShouldBe(bytes.Length);
        var listed = (await ListAsync("viewer")).Single();
        listed.Id.ShouldBe(created.Id);
        listed.Author.ShouldBe("editor");
    }

    [Test]
    public async Task The_bytes_come_from_the_stored_document_and_not_from_the_client()
    {
        await SaveDocumentAsync([9, 9]);
        using var client = As("owner");

        // A "state" the client may send is no part of the contract and is ignored.
        var created = await client.PostAsync(Url(), Json(new { name = "x", state = "BwcH" }));

        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        var snapshot = (await created.Content.ReadFromJsonAsync<SnapshotDto>())!;
        var document = await client.GetByteArrayAsync(Url($"/{snapshot.Id}/document"));
        document.ShouldBe(new byte[] { 9, 9 });
    }

    [Test]
    public async Task A_name_is_optional()
    {
        await SaveDocumentAsync([1]);
        using var client = As("owner");

        var response = await client.PostAsync(Url(), null);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        (await response.Content.ReadFromJsonAsync<SnapshotDto>())!.Name.ShouldBeNull();
    }

    [Test]
    public async Task A_name_longer_than_the_limit_is_refused()
    {
        await SaveDocumentAsync([1]);
        using var client = As("owner");

        var response = await client.PostAsync(Url(), Json(new { name = new string('x', 121) }));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ListAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_board_without_a_saved_document_has_nothing_to_keep()
    {
        using var client = As("owner");

        var response = await client.PostAsync(Url(), Json(new { name = "x" }));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        _factory.Files.Keys.ShouldBeEmpty();
    }

    [Test]
    public async Task A_board_keeps_at_most_100_saved_versions()
    {
        await SaveDocumentAsync([1]);
        await InDb(db =>
        {
            for (var i = 0; i < BoardSnapshotService.MaxManualPerBoard; i++)
            {
                db.BoardSnapshots.Add(new BoardSnapshot
                {
                    Id = Guid.CreateVersion7(),
                    BoardId = _board.Id,
                    Kind = SnapshotKind.Manual,
                    CreatedAt = Start.AddMinutes(i),
                });
            }

            return Task.CompletedTask;
        });
        using var client = As("owner");

        var response = await client.PostAsync(Url(), Json(new { name = "one more" }));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task The_list_is_newest_first()
    {
        await SaveDocumentAsync([1]);
        var first = await SaveVersionAsync("first");
        _time.Advance(TimeSpan.FromMinutes(5));
        var second = await SaveVersionAsync("second");

        (await ListAsync()).Select(s => s.Id).ShouldBe([second.Id, first.Id]);
    }

    [TestCase("owner", HttpStatusCode.OK, HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.NoContent)]
    [TestCase("editor", HttpStatusCode.OK, HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.Forbidden)]
    [TestCase("viewer",
        HttpStatusCode.OK,
        HttpStatusCode.Forbidden,
        HttpStatusCode.Forbidden,
        HttpStatusCode.Forbidden)]
    [TestCase("stranger",
        HttpStatusCode.NotFound,
        HttpStatusCode.NotFound,
        HttpStatusCode.NotFound,
        HttpStatusCode.NotFound)]
    public async Task Roles_decide_who_lists_saves_renames_and_deletes(string actor,
        HttpStatusCode list,
        HttpStatusCode create,
        HttpStatusCode rename,
        HttpStatusCode delete)
    {
        await SaveDocumentAsync([1]);
        var existing = await SaveVersionAsync("existing");
        using var client = As(actor);

        (await client.GetAsync(Url())).StatusCode.ShouldBe(list, "list");
        (await client.PostAsync(Url(), Json(new { name = "new" }))).StatusCode.ShouldBe(create, "create");
        (await client.PatchAsync(Url($"/{existing.Id}"), Json(new { name = "renamed" }))).StatusCode.ShouldBe(rename,
            "rename");
        (await client.DeleteAsync(Url($"/{existing.Id}"))).StatusCode.ShouldBe(delete, "delete");
    }

    [Test]
    public async Task Without_a_token_nothing_is_allowed()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync(Url())).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task A_viewer_can_read_the_state_of_a_version()
    {
        await SaveDocumentAsync([5, 6]);
        var created = await SaveVersionAsync();
        using var viewer = As("viewer");

        (await viewer.GetByteArrayAsync(Url($"/{created.Id}/document"))).ShouldBe(new byte[] { 5, 6 });
    }

    [Test]
    public async Task The_state_of_a_version_whose_object_is_gone_is_reported_missing()
    {
        await SaveDocumentAsync([5, 6]);
        var created = await SaveVersionAsync();
        await _factory.Files.DeleteAsync(FileTypes.SnapshotKey(_board.Id, created.Id), CancellationToken.None);
        using var owner = As("owner");

        (await owner.GetAsync(Url($"/{created.Id}/document"))).StatusCode.ShouldBe(HttpStatusCode.Gone);
        (await owner.GetAsync(Url($"/{Guid.NewGuid()}/document"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Rename_changes_the_name_of_a_saved_version()
    {
        await SaveDocumentAsync([1]);
        var created = await SaveVersionAsync("old");
        using var client = As("editor");

        var response = await client.PatchAsync(Url($"/{created.Id}"), Json(new { name = " new name " }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<SnapshotDto>())!.Name.ShouldBe("new name");
        (await ListAsync()).Single().Name.ShouldBe("new name");
    }

    [TestCase("")]
    [TestCase("   ")]
    public async Task Rename_needs_a_name(string name)
    {
        await SaveDocumentAsync([1]);
        var created = await SaveVersionAsync("old");
        using var client = As("editor");

        (await client.PatchAsync(Url($"/{created.Id}"), Json(new { name }))).StatusCode.ShouldBe(
            HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Rename_of_an_unknown_version_is_404_and_of_an_automatic_one_a_conflict()
    {
        await SaveDocumentAsync([1]);
        _time.Advance(TimeSpan.FromHours(2));
        await SaveDocumentAsync([2], 1);
        var automatic = (await ListAsync()).Single();
        using var client = As("editor");

        (await client.PatchAsync(Url($"/{Guid.NewGuid()}"), Json(new { name = "x" }))).StatusCode.ShouldBe(
            HttpStatusCode.NotFound);
        (await client.PatchAsync(Url($"/{automatic.Id}"), Json(new { name = "x" }))).StatusCode.ShouldBe(
            HttpStatusCode.Conflict);
    }

    [Test]
    public async Task Delete_removes_the_row_and_the_object_and_is_written_to_the_audit_log()
    {
        await SaveDocumentAsync([1]);
        var created = await SaveVersionAsync();
        using var owner = As("owner");

        (await owner.DeleteAsync(Url($"/{created.Id}"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await ListAsync()).ShouldBeEmpty();
        _factory.Files.Keys.ShouldBeEmpty();
        var entry = (await Query(db => db.AuditEntries.Where(e => e.Action == AuditActions.SnapshotDeleted)
            .ToListAsync())).Single();
        entry.SubjectId.ShouldBe(_board.Id);
        entry.ActorUserId.ShouldBe(_users["owner"].Id);
        entry.Details!.ShouldContain(created.Id.ToString());
        (await owner.DeleteAsync(Url($"/{created.Id}"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Deleting_the_board_deletes_its_versions_and_their_objects()
    {
        await SaveDocumentAsync([1]);
        await SaveVersionAsync();
        using var owner = As("owner");

        (await owner.DeleteAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        _factory.Files.Keys.ShouldBeEmpty();
    }

    [Test]
    public async Task A_save_after_an_hour_keeps_the_state_it_overwrites_as_an_automatic_version()
    {
        await SaveDocumentAsync([1]);
        (await ListAsync()).ShouldBeEmpty(); // the first save has nothing to keep
        _time.Advance(TimeSpan.FromMinutes(61));

        (await SaveDocumentAsync([2], 1, elements: 12)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var automatic = (await ListAsync()).Single();
        automatic.Kind.ShouldBe("Auto");
        automatic.Author.ShouldBeNull();
        automatic.Name.ShouldBeNull();
        automatic.ElementCount.ShouldBe(12);
        using var owner = As("owner");
        (await owner.GetByteArrayAsync(Url($"/{automatic.Id}/document"))).ShouldBe(new byte[] { 1 });
    }

    [Test]
    public async Task Saves_within_the_hour_make_no_automatic_version()
    {
        await SaveDocumentAsync([1]);
        _time.Advance(TimeSpan.FromMinutes(61));
        await SaveDocumentAsync([2], 1);
        _time.Advance(TimeSpan.FromMinutes(30));

        await SaveDocumentAsync([3], 2);

        (await ListAsync()).Length.ShouldBe(1);
    }

    [Test]
    public async Task A_save_that_changes_nothing_makes_no_automatic_version()
    {
        await SaveDocumentAsync([1]);
        _time.Advance(TimeSpan.FromHours(3));

        await SaveDocumentAsync([1], 1);

        (await ListAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_saved_version_counts_as_the_newest_snapshot_for_the_hour()
    {
        await SaveDocumentAsync([1]);
        _time.Advance(TimeSpan.FromMinutes(90));
        await SaveVersionAsync();
        _time.Advance(TimeSpan.FromMinutes(10));

        await SaveDocumentAsync([2], 1);

        (await ListAsync()).Length.ShouldBe(1);
    }

    [Test]
    public async Task A_compaction_save_keeps_the_old_state_whatever_the_age_of_the_newest_version()
    {
        await SaveDocumentAsync([1]);
        _time.Advance(TimeSpan.FromMinutes(5));
        await SaveVersionAsync();

        await SaveDocumentAsync([2], 1, "compaction");

        var all = await ListAsync();
        all.Length.ShouldBe(2);
        all.Count(s => s.Kind == "Auto").ShouldBe(1);
    }

    [Test]
    public async Task A_stale_save_makes_no_version_and_keeps_the_conflict_answer()
    {
        await SaveDocumentAsync([1]);
        await SaveDocumentAsync([2], 1, "compaction");
        var before = (await ListAsync()).Length;

        var stale = await SaveDocumentAsync([3], 1, "compaction");

        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ListAsync()).Length.ShouldBe(before);
    }

    [Test]
    public async Task A_save_for_a_board_that_is_no_uuid_makes_no_version()
    {
        using var realtime = _factory.CreateInternalClient();
        foreach (var version in new long?[] { null, 1 })
        {
            var request = new HttpRequestMessage(HttpMethod.Put, "/internal/boards/default/document")
            {
                Content = new ByteArrayContent([(byte)(version ?? 0)])
            };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            request.Headers.TryAddWithoutValidation(BoardDocumentEndpointsHeaders.SaveReason, "compaction");
            if (version is null)
                request.Headers.TryAddWithoutValidation("If-None-Match", "*");
            else
                request.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
            (await realtime.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        }

        (await Query(db => db.BoardSnapshots.CountAsync())).ShouldBe(0);
    }

    [Test]
    public async Task A_board_keeps_at_most_50_automatic_versions_and_the_oldest_go_first()
    {
        await SaveDocumentAsync([0]);
        for (var i = 1; i <= BoardSnapshotService.MaxAutomaticPerBoard + 3; i++)
        {
            _time.Advance(TimeSpan.FromMinutes(61));
            await SaveDocumentAsync([(byte)i], i);
        }

        var all = await ListAsync();
        all.Length.ShouldBe(BoardSnapshotService.MaxAutomaticPerBoard);
        _factory.Files.Keys.Count.ShouldBe(BoardSnapshotService.MaxAutomaticPerBoard);
        all[^1].CreatedAt.ShouldBe(Start.AddMinutes(61 * 4)); // the first three (and the one they pushed out) are gone
    }

    [Test]
    public async Task A_failing_object_store_does_not_fail_the_save()
    {
        await SaveDocumentAsync([1]);
        _time.Advance(TimeSpan.FromHours(2));
        using var scope = _factory.Services.CreateScope();
        var snapshots = ActivatorUtilities.CreateInstance<BoardSnapshotService>(scope.ServiceProvider,
            (IFileStore)new FailingFileStore());

        await Should.NotThrowAsync(() =>
            snapshots.TryCreateAutomaticAsync(_board.Id, [1], null, CancellationToken.None));

        (await ListAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task The_nightly_job_removes_expired_automatic_versions_and_keeps_saved_ones()
    {
        await SaveDocumentAsync([1]);
        var saved = await SaveVersionAsync("kept for ever");
        _time.Advance(TimeSpan.FromMinutes(61));
        await SaveDocumentAsync([2], 1);
        (await ListAsync()).Count(s => s.Kind == "Auto").ShouldBe(1);
        _time.Advance(BoardSnapshotService.AutomaticRetention - TimeSpan.FromMinutes(1));
        var job = _factory.Services.GetServices<IHostedService>().OfType<SnapshotCleanupService>().Single();

        (await job.ExpireAsync(CancellationToken.None)).ShouldBe(0); // a minute short of 30 days old: not yet
        _time.Advance(TimeSpan.FromMinutes(2));
        (await job.ExpireAsync(CancellationToken.None)).ShouldBe(1);

        (await ListAsync()).Select(s => s.Id).ShouldBe([saved.Id]);
        _factory.Files.Keys.ShouldBe([FileTypes.SnapshotKey(_board.Id, saved.Id)]);
    }

    [Test]
    public async Task The_nightly_job_removes_objects_without_a_row_only()
    {
        await SaveDocumentAsync([1]);
        var saved = await SaveVersionAsync();
        var orphan = FileTypes.SnapshotKey(_board.Id, Guid.NewGuid());
        await _factory.Files.PutAsync(orphan, new MemoryStream([1]), "application/gzip", CancellationToken.None);
        var job = _factory.Services.GetServices<IHostedService>().OfType<SnapshotCleanupService>().Single();

        (await job.RemoveOrphansAsync(CancellationToken.None)).ShouldBe(1);

        _factory.Files.Keys.ShouldBe([FileTypes.SnapshotKey(_board.Id, saved.Id)]);
    }

    [Test]
    public void The_nightly_job_runs_at_the_next_03_41_utc()
    {
        SnapshotCleanupService.UntilNextRun(new DateTimeOffset(2026, 10, 5, 3, 0, 0, TimeSpan.Zero))
            .ShouldBe(TimeSpan.FromMinutes(41));
        SnapshotCleanupService.UntilNextRun(new DateTimeOffset(2026, 10, 5, 4, 41, 0, TimeSpan.Zero))
            .ShouldBe(TimeSpan.FromHours(23));
    }

    private sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }

    private sealed class FailingFileStore : IFileStore
    {
        public Task EnsureReadyAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken) =>
            throw new HttpRequestException("The store is down.");

        public Task<StoredFile?> GetAsync(string key, CancellationToken cancellationToken) =>
            throw new HttpRequestException("The store is down.");

        public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) => Task.FromResult(false);
        public Task<int> CountAsync(string prefix, CancellationToken cancellationToken) => Task.FromResult(0);

        public Task<IReadOnlyList<string>> ListAsync(string prefix, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>([]);

        public Task DeleteAsync(string key, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task DeletePrefixAsync(string prefix, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task CopyPrefixAsync(string sourcePrefix, string targetPrefix, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    private static class BoardDocumentEndpointsHeaders
    {
        public const string SaveReason = Api.Endpoints.BoardDocumentEndpoints.SaveReasonHeader;
        public const string ElementCount = Api.Endpoints.BoardDocumentEndpoints.ElementCountHeader;
    }
}
