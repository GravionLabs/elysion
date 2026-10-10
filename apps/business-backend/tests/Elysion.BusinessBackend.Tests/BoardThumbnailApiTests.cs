using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Endpoints;
using Elysion.BusinessBackend.Api.Files;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The preview picture of a board, the image on its card (#729).</summary>
public class BoardThumbnailApiTests
{
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

    private async Task<BoardDto> CreateBoardAsync(string name = "Preview")
    {
        var response = await _client.PostAsJsonAsync("/boards", new BoardNameRequest(name));
        return (await response.Content.ReadFromJsonAsync<BoardDto>())!;
    }

    private static Task<HttpResponseMessage> PutAsync(HttpClient client,
        Guid boardId,
        byte[] bytes,
        string contentType = FileTypes.Png)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return client.PutAsync($"/boards/{boardId}/thumbnail", content);
    }

    private async Task<BoardDto> ReloadAsync(Guid id) =>
        (await _client.GetFromJsonAsync<BoardDto>($"/boards/{id}"))!;

    [Test]
    public async Task A_new_board_has_no_thumbnail_and_the_card_is_told_so()
    {
        var board = await CreateBoardAsync();

        board.HasThumbnail.ShouldBeFalse();
        board.ThumbnailUpdatedAt.ShouldBeNull();
        (await _client.GetAsync($"/boards/{board.Id}/thumbnail")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_stored_thumbnail_is_read_back_and_the_list_says_when_it_was_made()
    {
        var board = await CreateBoardAsync();

        (await PutAsync(_client, board.Id, Png)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        _factory.Files.Keys.ShouldBe([FileTypes.ThumbnailKey(board.Id)]); // outside the files of the board
        var response = await _client.GetAsync($"/boards/{board.Id}/thumbnail");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsByteArrayAsync()).ShouldBe(Png);
        response.Content.Headers.ContentType!.MediaType.ShouldBe(FileTypes.Png);
        response.Headers.ETag.ShouldNotBeNull();
        var listed = (await _client.GetFromJsonAsync<BoardDto[]>("/boards"))!.Single(b => b.Id == board.Id);
        listed.HasThumbnail.ShouldBeTrue();
        listed.ThumbnailUpdatedAt.ShouldNotBeNull();
    }

    [Test]
    public async Task A_new_picture_replaces_the_old_one_and_changes_the_version()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);
        var first = (await _client.GetAsync($"/boards/{board.Id}/thumbnail")).Headers.ETag!.Tag;
        await Task.Delay(20);
        byte[] other = [.. Png, 9, 9];

        await PutAsync(_client, board.Id, other);

        var response = await _client.GetAsync($"/boards/{board.Id}/thumbnail");
        (await response.Content.ReadAsByteArrayAsync()).ShouldBe(other);
        response.Headers.ETag!.Tag.ShouldNotBe(first);
        _factory.Files.Keys.Count.ShouldBe(1);
    }

    [Test]
    public async Task An_unchanged_picture_is_answered_304_to_a_browser_that_has_it()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);
        var etag = (await _client.GetAsync($"/boards/{board.Id}/thumbnail")).Headers.ETag!;
        var request = new HttpRequestMessage(HttpMethod.Get, $"/boards/{board.Id}/thumbnail");
        request.Headers.IfNoneMatch.Add(etag);

        var response = await _client.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.NotModified);
    }

    [Test]
    public async Task Only_a_PNG_of_a_sensible_size_is_taken()
    {
        var board = await CreateBoardAsync();

        (await PutAsync(_client, board.Id, Png, "image/jpeg")).StatusCode.ShouldBe(
            HttpStatusCode.UnsupportedMediaType);
        (await PutAsync(_client, board.Id, "<script>"u8.ToArray())).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var big = Png.Concat(new byte[BoardThumbnailEndpoints.MaxThumbnailBytes]).ToArray();
        (await PutAsync(_client, board.Id, big)).StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);

        _factory.Files.Keys.ShouldBeEmpty();
        (await ReloadAsync(board.Id)).HasThumbnail.ShouldBeFalse();
    }

    [Test]
    public async Task A_viewer_sees_the_picture_but_does_not_change_it_and_a_stranger_sees_nothing()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);
        using var viewer = _factory.CreateAuthenticatedClient("viewer-sub");
        await viewer.GetAsync("/boards");
        (await _client.PostAsJsonAsync($"/boards/{board.Id}/members",
            new AddMemberRequest("viewer-sub@example.com", "Viewer"))).StatusCode.ShouldBe(HttpStatusCode.Created);
        using var stranger = _factory.CreateAuthenticatedClient("stranger-sub");

        (await viewer.GetAsync($"/boards/{board.Id}/thumbnail")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await PutAsync(viewer, board.Id, Png)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await stranger.GetAsync($"/boards/{board.Id}/thumbnail")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await PutAsync(stranger, board.Id, Png)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Duplicating_a_board_copies_the_picture()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);

        var copy = (await (await _client.PostAsync($"/boards/{board.Id}/duplicate", null)).Content
            .ReadFromJsonAsync<BoardDto>())!;

        copy.HasThumbnail.ShouldBeTrue();
        var response = await _client.GetAsync($"/boards/{copy.Id}/thumbnail");
        (await response.Content.ReadAsByteArrayAsync()).ShouldBe(Png);
        _factory.Files.Keys.Count.ShouldBe(2);
    }

    [Test]
    public async Task Deleting_a_board_removes_its_picture()
    {
        var board = await CreateBoardAsync();
        await PutAsync(_client, board.Id, Png);

        (await _client.DeleteAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        _factory.Files.Keys.ShouldBeEmpty();
    }

    [Test]
    public async Task A_thumbnail_does_not_count_as_a_file_of_the_board()
    {
        var board = await CreateBoardAsync();

        await PutAsync(_client, board.Id, Png);

        _factory.Files.Keys.Count(key => key.StartsWith(FileTypes.Prefix(board.Id))).ShouldBe(0);
    }

    [Test]
    public async Task Thumbnails_need_a_token()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync($"/boards/{Guid.NewGuid()}/thumbnail")).StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized);
    }
}
