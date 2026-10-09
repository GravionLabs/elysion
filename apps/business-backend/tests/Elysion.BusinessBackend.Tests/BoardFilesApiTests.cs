using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Files;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class BoardFilesApiTests
{
    private const string FileId = "0123456789abcdef0123456789abcdef01234567";

    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    [SetUp]
    public void SetUp()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateAuthenticatedClient();
    }

    [TearDown]
    public void TearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private async Task<BoardDto> CreateBoardAsync()
    {
        var response = await _client.PostAsJsonAsync("/boards", new BoardNameRequest("Images"));
        return (await response.Content.ReadFromJsonAsync<BoardDto>())!;
    }

    private static Task<HttpResponseMessage> PutAsync(
        HttpClient client,
        Guid boardId,
        byte[] bytes,
        string contentType = FileTypes.Png,
        string fileId = FileId)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        return client.PutAsync($"/boards/{boardId}/files/{fileId}", content);
    }

    [Test]
    public async Task A_file_is_stored_under_the_board_and_read_back_with_cache_headers()
    {
        var board = await CreateBoardAsync();

        (await PutAsync(_client, board.Id, Png)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        _factory.Files.Keys.ShouldBe([$"boards/{board.Id}/{FileId}"]);
        var response = await _client.GetAsync($"/boards/{board.Id}/files/{FileId}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsByteArrayAsync()).ShouldBe(Png);
        response.Content.Headers.ContentType!.MediaType.ShouldBe(FileTypes.Png);
        response.Headers.CacheControl!.ToString().ShouldContain("immutable");
        response.Headers.CacheControl.Private.ShouldBeTrue();
        response.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);
    }

    [Test]
    public async Task The_same_file_twice_is_stored_once()
    {
        var board = await CreateBoardAsync();

        await PutAsync(_client, board.Id, Png);
        (await PutAsync(_client, board.Id, Png)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        _factory.Files.Keys.Count.ShouldBe(1);
    }

    [Test]
    public async Task A_file_that_is_not_there_is_404()
    {
        var board = await CreateBoardAsync();

        (await _client.GetAsync($"/boards/{board.Id}/files/{FileId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.GetAsync($"/boards/{board.Id}/files/..%2F..")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_file_of_one_board_is_not_found_through_another()
    {
        var board = await CreateBoardAsync();
        var other = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);

        (await _client.GetAsync($"/boards/{other.Id}/files/{FileId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_file_over_the_size_limit_is_413_and_not_stored()
    {
        var board = await CreateBoardAsync();
        var big = Png.Concat(new byte[ApiFactory.MaxFileBytes]).ToArray();

        (await PutAsync(_client, board.Id, big)).StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);

        _factory.Files.Keys.ShouldBeEmpty();
    }

    [Test]
    public async Task A_file_of_exactly_the_limit_is_accepted()
    {
        var board = await CreateBoardAsync();
        var exact = Png.Concat(new byte[ApiFactory.MaxFileBytes - Png.Length]).ToArray();

        (await PutAsync(_client, board.Id, exact)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [TestCase("image/svg+xml")]
    [TestCase("text/html")]
    [TestCase("application/octet-stream")]
    public async Task A_type_that_is_not_allowed_is_415(string contentType)
    {
        var board = await CreateBoardAsync();

        (await PutAsync(_client, board.Id, Png, contentType)).StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
    }

    [Test]
    public async Task Bytes_that_are_not_the_declared_image_are_400()
    {
        var board = await CreateBoardAsync();
        var html = "<script>alert(1)</script>"u8.ToArray();

        var response = await PutAsync(_client, board.Id, html);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        _factory.Files.Keys.ShouldBeEmpty();
    }

    [Test]
    public async Task A_png_declared_as_jpeg_is_400()
    {
        var board = await CreateBoardAsync();

        (await PutAsync(_client, board.Id, Png, FileTypes.Jpeg)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [TestCase("short")]
    [TestCase("has.dot.in.it.0000")]
    [TestCase("space space space")]
    public async Task A_file_id_that_is_not_an_id_is_400(string fileId)
    {
        var board = await CreateBoardAsync();

        (await PutAsync(_client, board.Id, Png, fileId: fileId)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task A_board_holds_a_limited_number_of_files_and_the_same_one_does_not_count_twice()
    {
        var board = await CreateBoardAsync();
        for (var i = 0; i < ApiFactory.MaxFilesPerBoard; i++)
        {
            (await PutAsync(_client, board.Id, Png, fileId: $"file-id-{i:D4}")).StatusCode.ShouldBe(HttpStatusCode
                .NoContent);
        }

        (await PutAsync(_client, board.Id, Png, fileId: "file-id-9999")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await PutAsync(_client, board.Id, Png, fileId: "file-id-0000")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task A_viewer_reads_but_does_not_write_and_a_stranger_sees_nothing()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);
        using var viewer = _factory.CreateAuthenticatedClient("viewer-sub");
        await viewer.GetAsync("/boards"); // signs the viewer in, so that they can be shared with
        (await _client.PostAsJsonAsync($"/boards/{board.Id}/members",
            new AddMemberRequest("viewer-sub@example.com", "Viewer"))).StatusCode.ShouldBe(HttpStatusCode.Created);
        using var stranger = _factory.CreateAuthenticatedClient("stranger-sub");

        (await viewer.GetAsync($"/boards/{board.Id}/files/{FileId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await PutAsync(viewer, board.Id, Png, fileId: "viewer-file-1")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await stranger.GetAsync($"/boards/{board.Id}/files/{FileId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await PutAsync(stranger, board.Id, Png, fileId: "stranger-file-1")).StatusCode.ShouldBe(
            HttpStatusCode.NotFound);
        _factory.Files.Keys.ShouldBe([$"boards/{board.Id}/{FileId}"]);
    }

    [Test]
    public async Task Files_need_a_token()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync($"/boards/{Guid.NewGuid()}/files/{FileId}")).StatusCode.ShouldBe(HttpStatusCode
            .Unauthorized);
    }

    [Test]
    public async Task Deleting_a_board_deletes_its_files_and_only_its_files()
    {
        var board = await CreateBoardAsync();
        var other = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);
        await PutAsync(_client, other.Id, Png);

        (await _client.DeleteAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        _factory.Files.Keys.ShouldBe([$"boards/{other.Id}/{FileId}"]);
    }

    [Test]
    public async Task Duplicating_a_board_copies_its_files()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);

        var response = await _client.PostAsync($"/boards/{board.Id}/duplicate", content: null);
        var copy = (await response.Content.ReadFromJsonAsync<BoardDto>())!;

        _factory.Files.Keys.OrderBy(k => k, StringComparer.Ordinal)
            .ToList()
            .ShouldBe(
                new[] { $"boards/{board.Id}/{FileId}", $"boards/{copy.Id}/{FileId}" }
                    .OrderBy(k => k, StringComparer.Ordinal)
                    .ToList());
        (await _client.GetAsync($"/boards/{copy.Id}/files/{FileId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [TestCase(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }, FileTypes.Jpeg)]
    [TestCase(new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 }, FileTypes.Gif)]
    [TestCase(new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50 }, FileTypes.WebP)]
    [TestCase(new byte[] { 0x3C, 0x73, 0x76, 0x67 }, null)]
    public void The_types_are_recognized_by_their_first_bytes(byte[] bytes, string? expected) =>
        FileTypes.Sniff(bytes).ShouldBe(expected);
}
