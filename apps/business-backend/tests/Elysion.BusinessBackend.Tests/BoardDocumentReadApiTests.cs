using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// <c>GET /boards/{id}/document</c>: the stored state of a board for anybody who may read it, which the BFF decodes for the public
/// API's elements (ADR 0033, #852).
/// </summary>
public class BoardDocumentReadApiTests
{
    private static readonly string[] ReadScope = ["boards:read"];
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private Board _board = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        _users.Clear();
        foreach (var name in new[] { "owner", "viewer", "stranger" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Start);
        }

        _board = Board.Create(Guid.CreateVersion7(), "Retro", Start, _users["owner"].Id);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(_board,
            BoardMembership.Create(_board.Id, _users["owner"].Id, BoardRole.Owner, Start),
            BoardMembership.Create(_board.Id, _users["viewer"].Id, BoardRole.Viewer, Start));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private HttpClient As(string name) =>
        _factory.CreateAuthenticatedClient(name,
        [
            new System.Security.Claims.Claim("sub", name), new("email", $"{name}@example.com"),
            new("preferred_username", name)
        ]);

    private string Url => $"/boards/{_board.Id}/document";

    private async Task SaveAsync(byte[] state)
    {
        using var realtime = _factory.CreateInternalClient();
        var request = new HttpRequestMessage(HttpMethod.Put, $"/internal/boards/{_board.Id}/document")
        {
            Content = new ByteArrayContent(state)
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Headers.TryAddWithoutValidation("If-None-Match", "*");
        (await realtime.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task A_viewer_reads_the_stored_state_with_its_version()
    {
        byte[] state = [1, 2, 3, 250];
        await SaveAsync(state);

        var response = await As("viewer").GetAsync(Url);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/octet-stream");
        response.Headers.ETag!.Tag.ShouldBe("\"1\"");
        (await response.Content.ReadAsByteArrayAsync()).ShouldBe(state);
    }

    [Test]
    public async Task A_board_that_was_never_saved_answers_204()
    {
        var response = await As("owner").GetAsync(Url);

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task Somebody_without_a_role_gets_404_like_for_a_board_that_does_not_exist()
    {
        await SaveAsync([1]);

        (await As("stranger").GetAsync(Url)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await As("owner").GetAsync($"/boards/{Guid.CreateVersion7()}/document")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task An_anonymous_request_is_401()
    {
        (await _factory.CreateClient().GetAsync(Url)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task A_personal_access_token_reads_as_its_owner_and_never_more()
    {
        await SaveAsync([7, 7]);
        var created = await As("viewer")
            .PostAsync("/access-tokens",
                new StringContent(
                    JsonSerializer.Serialize(new { name = "export", scopes = ReadScope, expiresInDays = 7 }),
                    Encoding.UTF8,
                    "application/json"));
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        var token = (await created.Content.ReadFromJsonAsync<CreatedAccessTokenDto>(JsonSerializerOptions.Web))!.Token;
        using var script = _factory.CreateClient();
        script.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var own = await script.GetAsync(Url);
        var foreign = await script.GetAsync($"/boards/{Guid.CreateVersion7()}/document");

        own.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await own.Content.ReadAsByteArrayAsync()).ShouldBe(new byte[] { 7, 7 });
        foreign.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
