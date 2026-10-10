using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>What a person keeps about a board for themselves: when they opened it and a star, plus the search of the list (#730).</summary>
public class BoardUserStateApiTests
{
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

    private async Task<BoardDto> CreateBoardAsync(string name)
    {
        var response = await _client.PostAsJsonAsync("/boards", new BoardNameRequest(name));
        return (await response.Content.ReadFromJsonAsync<BoardDto>())!;
    }

    private async Task<BoardDto[]> ListAsync(string url = "/boards") =>
        (await _client.GetFromJsonAsync<BoardDto[]>(url))!;

    [Test]
    public async Task A_new_board_was_never_opened_and_is_not_starred()
    {
        var board = await CreateBoardAsync("Fresh");

        var listed = (await ListAsync()).Single(b => b.Id == board.Id);

        listed.LastOpenedAt.ShouldBeNull();
        listed.IsFavorite.ShouldBeFalse();
    }

    [Test]
    public async Task Opening_a_board_records_when_and_the_list_and_the_board_say_so()
    {
        var board = await CreateBoardAsync("Opened");

        (await _client.PostAsync($"/boards/{board.Id}/open", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await ListAsync()).Single(b => b.Id == board.Id).LastOpenedAt.ShouldNotBeNull();
        (await _client.GetFromJsonAsync<BoardDto>($"/boards/{board.Id}"))!.LastOpenedAt.ShouldNotBeNull();
    }

    [Test]
    public async Task Opening_again_at_once_changes_nothing()
    {
        var board = await CreateBoardAsync("Twice");
        await _client.PostAsync($"/boards/{board.Id}/open", null);
        var first = (await ListAsync()).Single(b => b.Id == board.Id).LastOpenedAt;

        (await _client.PostAsync($"/boards/{board.Id}/open", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await ListAsync()).Single(b => b.Id == board.Id).LastOpenedAt.ShouldBe(first);
    }

    [Test]
    public async Task A_star_is_set_and_taken_away_and_both_are_idempotent()
    {
        var board = await CreateBoardAsync("Star");

        (await _client.PutAsync($"/boards/{board.Id}/favorite", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _client.PutAsync($"/boards/{board.Id}/favorite", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ListAsync()).Single(b => b.Id == board.Id).IsFavorite.ShouldBeTrue();

        (await _client.DeleteAsync($"/boards/{board.Id}/favorite")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _client.DeleteAsync($"/boards/{board.Id}/favorite")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ListAsync()).Single(b => b.Id == board.Id).IsFavorite.ShouldBeFalse();
    }

    [Test]
    public async Task A_board_the_caller_cannot_read_is_a_404_for_both()
    {
        var unknown = Guid.NewGuid();

        (await _client.PostAsync($"/boards/{unknown}/open", null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.PutAsync($"/boards/{unknown}/favorite", null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Deleting_a_board_takes_the_visit_and_the_star_with_it()
    {
        var board = await CreateBoardAsync("Gone");
        await _client.PostAsync($"/boards/{board.Id}/open", null);
        await _client.PutAsync($"/boards/{board.Id}/favorite", null);

        (await _client.DeleteAsync($"/boards/{board.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await ListAsync()).ShouldNotContain(b => b.Id == board.Id);
    }

    [Test]
    public async Task The_query_finds_boards_by_part_of_the_name_ignoring_case()
    {
        await CreateBoardAsync("Sprint Retro");
        await CreateBoardAsync("Roadmap");

        (await ListAsync("/boards?query=retro")).Select(b => b.Name).ShouldBe(["Sprint Retro"]);
        (await ListAsync("/boards?query=%20")).Length.ShouldBe(2);
        (await ListAsync("/boards?query=nothing")).ShouldBeEmpty();
    }
}
