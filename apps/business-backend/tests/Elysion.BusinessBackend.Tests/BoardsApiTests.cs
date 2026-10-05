using System.Net;
using System.Net.Http.Json;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Controllers;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class BoardsApiTests
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
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<BoardDto>())!;
    }

    [Test]
    public async Task Create_returns_201_with_location_and_the_board()
    {
        var response = await _client.PostAsJsonAsync("/boards", new BoardNameRequest("Sprint planning"));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var board = (await response.Content.ReadFromJsonAsync<BoardDto>())!;
        board.Name.ShouldBe("Sprint planning");
        board.Id.ShouldNotBe(Guid.Empty);
        response.Headers.Location!.AbsolutePath.ShouldBe($"/boards/{board.Id}");
    }

    [Test]
    public async Task Create_trims_the_name()
    {
        var board = await CreateAsync("  Retro  ");

        board.Name.ShouldBe("Retro");
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("   ")]
    public async Task Create_rejects_a_missing_or_blank_name_with_problem_details(string? name)
    {
        var response = await _client.PostAsJsonAsync("/boards", new BoardNameRequest(name));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!;
        problem.Errors.ShouldContainKey("name");
    }

    [Test]
    public async Task Create_accepts_a_name_of_exactly_the_maximum_length_and_rejects_one_more()
    {
        var longest = new string('x', BoardsController.MaxNameLength);

        (await CreateAsync(longest)).Name.ShouldBe(longest);

        var tooLong = await _client.PostAsJsonAsync("/boards", new BoardNameRequest(longest + "x"));
        tooLong.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Create_without_a_json_body_is_rejected()
    {
        var response = await _client.PostAsync("/boards", content: null);

        response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
    }

    [Test]
    public async Task Get_returns_the_board_or_404()
    {
        var created = await CreateAsync("Roadmap");

        var found = await _client.GetAsync($"/boards/{created.Id}");
        found.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await found.Content.ReadFromJsonAsync<BoardDto>())!.ShouldBe(created);

        (await _client.GetAsync($"/boards/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_route_id_that_is_not_a_guid_is_404()
    {
        (await _client.GetAsync("/boards/not-a-guid")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task List_is_empty_at_first()
    {
        var boards = await _client.GetFromJsonAsync<List<BoardDto>>("/boards");

        boards.ShouldNotBeNull().ShouldBeEmpty();
    }

    [Test]
    public async Task List_returns_the_newest_board_first()
    {
        var time = Substitute.For<TimeProvider>();
        using var factory = new ApiFactory(time);
        using var client = factory.CreateClient();

        foreach (var (name, at) in new[]
                 {
                     ("first", new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero)),
                     ("second", new DateTimeOffset(2026, 10, 2, 9, 0, 0, TimeSpan.Zero)),
                     ("third", new DateTimeOffset(2026, 10, 3, 9, 0, 0, TimeSpan.Zero)),
                 })
        {
            time.GetUtcNow().Returns(at);
            (await client.PostAsJsonAsync("/boards", new BoardNameRequest(name))).EnsureSuccessStatusCode();
        }

        var boards = (await client.GetFromJsonAsync<List<BoardDto>>("/boards"))!;

        boards.Select(b => b.Name).ShouldBe(["third", "second", "first"]);
        boards[0].CreatedAt.ShouldBe(new DateTimeOffset(2026, 10, 3, 9, 0, 0, TimeSpan.Zero));
    }

    [Test]
    public async Task Create_keeps_microsecond_precision_like_the_database_does()
    {
        var time = Substitute.For<TimeProvider>();
        // 7th fractional digit set: Postgres would cut it off on the next read.
        time.GetUtcNow().Returns(new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero).AddTicks(1_234_567));
        using var factory = new ApiFactory(time);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/boards", new BoardNameRequest("Precise"));
        var created = (await response.Content.ReadFromJsonAsync<BoardDto>())!;

        (created.CreatedAt.Ticks % 10).ShouldBe(0);
        created.CreatedAt.Ticks.ShouldBe(new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero).AddTicks(1_234_560).Ticks);
    }

    [Test]
    public async Task Rename_changes_the_name_and_keeps_id_and_creation_time()
    {
        var created = await CreateAsync("Old name");

        var response = await _client.PatchAsJsonAsync($"/boards/{created.Id}", new BoardNameRequest(" New name "));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var renamed = (await response.Content.ReadFromJsonAsync<BoardDto>())!;
        renamed.ShouldBe(created with { Name = "New name" });
        (await _client.GetFromJsonAsync<BoardDto>($"/boards/{created.Id}"))!.Name.ShouldBe("New name");
    }

    [Test]
    public async Task Rename_rejects_a_blank_name_and_leaves_the_board_alone()
    {
        var created = await CreateAsync("Keep me");

        var response = await _client.PatchAsJsonAsync($"/boards/{created.Id}", new BoardNameRequest(" "));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _client.GetFromJsonAsync<BoardDto>($"/boards/{created.Id}"))!.Name.ShouldBe("Keep me");
    }

    [Test]
    public async Task Rename_of_an_unknown_board_is_404()
    {
        var response = await _client.PatchAsJsonAsync($"/boards/{Guid.NewGuid()}", new BoardNameRequest("x"));

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Delete_removes_the_board()
    {
        var created = await CreateAsync("Temporary");

        (await _client.DeleteAsync($"/boards/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await _client.GetAsync($"/boards/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.GetFromJsonAsync<List<BoardDto>>("/boards"))!.ShouldBeEmpty();
    }

    [Test]
    public async Task Delete_of_an_unknown_board_is_404()
    {
        (await _client.DeleteAsync($"/boards/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
