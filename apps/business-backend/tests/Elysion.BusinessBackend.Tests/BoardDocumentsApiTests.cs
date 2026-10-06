using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Elysion.BusinessBackend.Api.Contracts;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class BoardDocumentsApiTests
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    [SetUp]
    public void SetUp()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateInternalClient(); // the realtime service's own token (ADR 0017)
    }

    [TearDown]
    public void TearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private static string Url(string boardId) => $"/internal/boards/{boardId}/document";

    private Task<HttpResponseMessage> PutAsync(string boardId, byte[] state, string? ifMatch = null, bool ifNoneMatchAny = false)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, Url(boardId)) { Content = new ByteArrayContent(state) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        if (ifNoneMatchAny) request.Headers.TryAddWithoutValidation("If-None-Match", "*");
        return _client.SendAsync(request);
    }

    [Test]
    public async Task Get_answers_404_for_a_board_without_a_document()
    {
        var response = await _client.GetAsync(Url("default"));

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task The_first_save_creates_version_1_and_get_returns_the_exact_bytes()
    {
        byte[] state = [0, 1, 2, 250, 251, 255];

        var put = await PutAsync("default", state, ifNoneMatchAny: true);
        var get = await _client.GetAsync(Url("default"));

        put.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        put.Headers.ETag!.Tag.ShouldBe("\"1\"");
        get.StatusCode.ShouldBe(HttpStatusCode.OK);
        get.Headers.ETag!.Tag.ShouldBe("\"1\"");
        (await get.Content.ReadAsByteArrayAsync()).ShouldBe(state);
    }

    [Test]
    public async Task A_save_based_on_the_stored_version_replaces_the_state_and_bumps_the_version()
    {
        await PutAsync("b", [1], ifNoneMatchAny: true);

        var put = await PutAsync("b", [2, 2], ifMatch: "\"1\"");
        var get = await _client.GetAsync(Url("b"));

        put.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        put.Headers.ETag!.Tag.ShouldBe("\"2\"");
        (await get.Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 2, 2 });
    }

    [Test]
    public async Task A_save_based_on_an_old_version_is_rejected_with_409_and_the_current_state()
    {
        await PutAsync("b", [1], ifNoneMatchAny: true);
        await PutAsync("b", [2], ifMatch: "\"1\"");

        var stale = await PutAsync("b", [9], ifMatch: "\"1\"");

        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        stale.Headers.ETag!.Tag.ShouldBe("\"2\"");
        (await stale.Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 2 });
        (await (await _client.GetAsync(Url("b"))).Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 2 });
    }

    [Test]
    public async Task A_second_first_save_is_rejected_with_409_and_the_stored_state()
    {
        await PutAsync("b", [1], ifNoneMatchAny: true);

        var again = await PutAsync("b", [7], ifNoneMatchAny: true);

        again.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await again.Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 1 });
    }

    [Test]
    public async Task A_save_without_a_precondition_is_rejected_with_428()
    {
        var response = await PutAsync("b", [1]);

        response.StatusCode.ShouldBe(HttpStatusCode.PreconditionRequired);
        (await _client.GetAsync(Url("b"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_save_with_a_version_for_a_board_without_a_document_answers_404()
    {
        var response = await PutAsync("b", [1], ifMatch: "\"1\"");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Delete_removes_the_document_and_is_idempotent()
    {
        await PutAsync("b", [1], ifNoneMatchAny: true);

        (await _client.DeleteAsync(Url("b"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _client.DeleteAsync(Url("b"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _client.GetAsync(Url("b"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Documents_of_different_boards_are_independent()
    {
        await PutAsync("one", [1], ifNoneMatchAny: true);
        await PutAsync("two", [2], ifNoneMatchAny: true);

        (await (await _client.GetAsync(Url("one"))).Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 1 });
        (await (await _client.GetAsync(Url("two"))).Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 2 });
    }

    [Test]
    public async Task A_board_id_longer_than_200_characters_is_a_bad_request()
    {
        var response = await _client.GetAsync(Url(new string('x', 201)));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Deleting_a_board_deletes_its_document()
    {
        // The board API needs a signed-in user; the document API does not (the realtime service has no token).
        using var signedIn = _factory.CreateAuthenticatedClient();
        var created = await signedIn.PostAsJsonAsync("/boards", new BoardNameRequest("Workshop"));
        var board = (await created.Content.ReadFromJsonAsync<BoardDto>())!;
        await PutAsync(board.Id.ToString(), [1, 2, 3], ifNoneMatchAny: true);
        await PutAsync("default", [9], ifNoneMatchAny: true);

        (await signedIn.DeleteAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await _client.GetAsync(Url(board.Id.ToString()))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.GetAsync(Url("default"))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
