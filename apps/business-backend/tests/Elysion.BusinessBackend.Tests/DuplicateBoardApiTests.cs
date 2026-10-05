using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Endpoints;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class DuplicateBoardApiTests
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    [SetUp]
    public void SetUp()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
    }

    [TearDown]
    public void TearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private async Task<BoardDto> CreateAsync(string name)
    {
        var response = await _client.PostAsJsonAsync("/boards", new BoardNameRequest(name));
        return (await response.Content.ReadFromJsonAsync<BoardDto>())!;
    }

    private async Task PutDocumentAsync(Guid boardId, byte[] state, string? ifMatch = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/internal/boards/{boardId}/document")
        {
            Content = new ByteArrayContent(state),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        if (ifMatch is null) request.Headers.TryAddWithoutValidation("If-None-Match", "*");
        else request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        (await _client.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    private Task<HttpResponseMessage> GetDocumentAsync(Guid boardId) =>
        _client.GetAsync($"/internal/boards/{boardId}/document");

    [Test]
    public async Task Duplicate_creates_a_new_board_named_copy_and_answers_201_with_an_absolute_location()
    {
        var source = await CreateAsync("Retro");

        var response = await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var copy = (await response.Content.ReadFromJsonAsync<BoardDto>())!;
        copy.Name.ShouldBe("Retro (copy)");
        copy.Id.ShouldNotBe(source.Id);
        response.Headers.Location!.AbsolutePath.ShouldBe($"/boards/{copy.Id}");
        (await _client.GetFromJsonAsync<List<BoardDto>>("/boards"))!.Count.ShouldBe(2);
    }

    [Test]
    public async Task Duplicate_leaves_the_source_board_alone()
    {
        var source = await CreateAsync("Retro");

        await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null);

        (await _client.GetFromJsonAsync<BoardDto>($"/boards/{source.Id}")).ShouldBe(source);
    }

    [Test]
    public async Task Duplicate_copies_the_stored_document_byte_for_byte()
    {
        var source = await CreateAsync("Retro");
        byte[] state = [0, 1, 2, 200, 255, 7];
        await PutDocumentAsync(source.Id, state);

        var copy = (await (await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null))
            .Content.ReadFromJsonAsync<BoardDto>())!;

        var document = await GetDocumentAsync(copy.Id);
        document.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await document.Content.ReadAsByteArrayAsync()).ShouldBe(state);
        document.Headers.ETag!.Tag.ShouldBe("\"1\""); // a fresh document, not the source's version
    }

    [Test]
    public async Task The_copy_and_the_source_are_independent_afterwards()
    {
        var source = await CreateAsync("Retro");
        await PutDocumentAsync(source.Id, [1, 1, 1]);
        var copy = (await (await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null))
            .Content.ReadFromJsonAsync<BoardDto>())!;

        await PutDocumentAsync(copy.Id, [9, 9], ifMatch: "\"1\"");

        (await (await GetDocumentAsync(source.Id)).Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 1, 1, 1 });
        await _client.DeleteAsync($"/boards/{source.Id}");
        (await GetDocumentAsync(copy.Id)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task Duplicate_of_a_board_without_content_makes_a_board_without_a_document()
    {
        var source = await CreateAsync("Empty");

        var copy = (await (await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null))
            .Content.ReadFromJsonAsync<BoardDto>())!;

        (await GetDocumentAsync(copy.Id)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Duplicate_of_an_unknown_board_is_404_and_a_non_guid_id_is_404()
    {
        (await _client.PostAsync($"/boards/{Guid.NewGuid()}/duplicate", content: null))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.PostAsync("/boards/not-a-guid/duplicate", content: null))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.GetFromJsonAsync<List<BoardDto>>("/boards"))!.ShouldBeEmpty();
    }

    [Test]
    public async Task A_name_that_would_not_fit_with_the_suffix_is_cut_short_to_the_limit()
    {
        var source = await CreateAsync(new string('x', BoardEndpoints.MaxNameLength));

        var copy = (await (await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null))
            .Content.ReadFromJsonAsync<BoardDto>())!;

        copy.Name.Length.ShouldBe(BoardEndpoints.MaxNameLength);
        copy.Name.ShouldEndWith(" (copy)");
        copy.Name.ShouldStartWith("xxxx");
    }

    [Test]
    public async Task Duplicating_a_copy_adds_another_suffix()
    {
        var source = await CreateAsync("Retro");
        var first = (await (await _client.PostAsync($"/boards/{source.Id}/duplicate", content: null))
            .Content.ReadFromJsonAsync<BoardDto>())!;

        var second = (await (await _client.PostAsync($"/boards/{first.Id}/duplicate", content: null))
            .Content.ReadFromJsonAsync<BoardDto>())!;

        second.Name.ShouldBe("Retro (copy) (copy)");
    }
}
