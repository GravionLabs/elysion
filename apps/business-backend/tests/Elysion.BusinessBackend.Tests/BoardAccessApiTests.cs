using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The internal access check the realtime service repeats while a socket is open (#772).</summary>
public class BoardAccessApiTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private HttpClient _internal = null!;
    private Board _board = null!;

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        _internal = _factory.CreateInternalClient();
        var owner = NewUser("owner");
        var editor = NewUser("editor");
        var stranger = NewUser("stranger");
        _board = Board.Create(Guid.CreateVersion7(), "Retro", Now, owner.Id);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(owner,
            editor,
            stranger,
            _board,
            BoardMembership.Create(_board.Id, owner.Id, BoardRole.Owner, Now),
            BoardMembership.Create(_board.Id, editor.Id, BoardRole.Editor, Now));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown()
    {
        _internal.Dispose();
        _factory.Dispose();
    }

    private static User NewUser(string subject) => User.Create(Guid.CreateVersion7(), subject, subject, null, Now);

    private Task<HttpResponseMessage> AskAsync(string boardId, string sub) =>
        _internal.GetAsync($"/internal/boards/{boardId}/access?sub={Uri.EscapeDataString(sub)}");

    [TestCase("owner", "Owner")]
    [TestCase("editor", "Editor")]
    public async Task A_member_gets_the_role_the_board_gives_them_now(string sub, string role)
    {
        var response = await AskAsync(_board.Id.ToString(), sub);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<MembershipDto>()).ShouldBe(new MembershipDto(_board.Id, role));
    }

    [Test]
    public async Task A_removed_member_and_a_lowered_role_show_at_once()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
            db.Remove(db.Set<BoardMembership>().Single(m => m.BoardId == _board.Id && m.Role == BoardRole.Editor));
            await db.SaveChangesAsync();
        }

        (await AskAsync(_board.Id.ToString(), "editor")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Somebody_without_a_role_an_unknown_person_and_an_unknown_board_look_the_same()
    {
        (await AskAsync(_board.Id.ToString(), "stranger")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await AskAsync(_board.Id.ToString(), "nobody")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await AskAsync(Guid.NewGuid().ToString(), "owner")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await AskAsync("default", "owner")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _internal.GetAsync($"/internal/boards/{_board.Id}/access")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_deleted_board_has_no_role_for_anybody()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
            db.Remove(await db.Set<Board>().FindAsync(_board.Id) ?? throw new InvalidOperationException());
            await db.SaveChangesAsync();
        }

        (await AskAsync(_board.Id.ToString(), "owner")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Only_the_realtime_services_token_opens_it()
    {
        using var anonymous = _factory.CreateClient();
        using var user = _factory.CreateAuthenticatedClient("owner");
        var url = $"/internal/boards/{_board.Id}/access?sub=owner";

        (await anonymous.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await user.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
