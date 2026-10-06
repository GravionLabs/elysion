using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// The board policies through the real pipeline: each role against read, write and administer, and the rule
/// that somebody with no role on a board gets 404, not 403.
/// </summary>
public class BoardAuthorizationTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private Board _board = null!;
    private Board _implicitOwnersBoard = null!;
    private Board _legacyBoard = null!;

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        var owner = NewUser("owner");
        var editor = NewUser("editor");
        var viewer = NewUser("viewer");
        var implicitOwner = NewUser("implicit-owner");
        _board = Board.Create(Guid.CreateVersion7(), "Retro", Now, owner.Id);
        _implicitOwnersBoard =
            Board.Create(Guid.CreateVersion7(), "Implicit", Now.AddMinutes(-1), implicitOwner.Id); // no membership row
        _legacyBoard = Board.Create(Guid.CreateVersion7(), "Legacy", Now.AddMinutes(-2)); // from before users: no owner
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(
            owner,
            editor,
            viewer,
            implicitOwner,
            _board,
            _implicitOwnersBoard,
            _legacyBoard,
            BoardMembership.Create(_board.Id, owner.Id, BoardRole.Owner, Now),
            BoardMembership.Create(_board.Id, editor.Id, BoardRole.Editor, Now),
            BoardMembership.Create(_board.Id, viewer.Id, BoardRole.Viewer, Now));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private static User NewUser(string subject) => User.Create(Guid.CreateVersion7(), subject, subject, null, Now);

    private async Task<T> InDatabaseAsync<T>(Func<ElysionDbContext, Task<T>> query)
    {
        using var scope = _factory.Services.CreateScope();
        return await query(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    private static StringContent Json(string name) =>
        new($$"""{"name":"{{name}}"}""", System.Text.Encoding.UTF8, "application/json");

    private async Task<HttpStatusCode> ReadAsync(string actor, Guid boardId)
    {
        using var client = _factory.CreateAuthenticatedClient(actor);
        return (await client.GetAsync($"/boards/{boardId}")).StatusCode;
    }

    private async Task<HttpStatusCode> WriteAsync(string actor, Guid boardId)
    {
        using var client = _factory.CreateAuthenticatedClient(actor);
        return (await client.PatchAsync($"/boards/{boardId}", Json("Renamed"))).StatusCode;
    }

    private async Task<HttpStatusCode> AdministerAsync(string actor, Guid boardId)
    {
        using var client = _factory.CreateAuthenticatedClient(actor);
        return (await client.DeleteAsync($"/boards/{boardId}")).StatusCode;
    }

    // Read (GET), write (rename) and administer (delete) for every role. A role that is too low is 403: that
    // person knows the board. Someone without a role gets 404: they must not learn that the board exists.
    [TestCase("owner", HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.NoContent)]
    [TestCase("editor", HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.Forbidden)]
    [TestCase("viewer", HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden)]
    [TestCase("stranger", HttpStatusCode.NotFound, HttpStatusCode.NotFound, HttpStatusCode.NotFound)]
    public async Task The_role_decides_what_a_user_may_do_on_a_board(
        string actor,
        HttpStatusCode read,
        HttpStatusCode write,
        HttpStatusCode administer)
    {
        (await ReadAsync(actor, _board.Id)).ShouldBe(read, "read");
        (await WriteAsync(actor, _board.Id)).ShouldBe(write, "write");
        (await AdministerAsync(actor, _board.Id)).ShouldBe(administer, "administer");
    }

    [Test]
    public async Task The_owner_of_a_board_is_an_owner_without_a_membership_row()
    {
        (await ReadAsync("implicit-owner", _implicitOwnersBoard.Id)).ShouldBe(HttpStatusCode.OK);
        (await WriteAsync("implicit-owner", _implicitOwnersBoard.Id)).ShouldBe(HttpStatusCode.OK);
        (await AdministerAsync("implicit-owner", _implicitOwnersBoard.Id)).ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task A_board_that_does_not_exist_is_404_for_everybody_like_a_board_they_may_not_see()
    {
        var missing = Guid.NewGuid();
        foreach (var actor in new[] { "owner", "editor", "viewer", "stranger" })
        {
            (await ReadAsync(actor, missing)).ShouldBe(HttpStatusCode.NotFound, actor);
            (await WriteAsync(actor, missing)).ShouldBe(HttpStatusCode.NotFound, actor);
            (await AdministerAsync(actor, missing)).ShouldBe(HttpStatusCode.NotFound, actor);
        }
    }

    [Test]
    public async Task A_stranger_cannot_tell_a_board_they_may_not_see_from_one_that_is_not_there()
    {
        using var client = _factory.CreateAuthenticatedClient("stranger");

        var hidden = await client.GetAsync($"/boards/{_board.Id}");
        var missing = await client.GetAsync($"/boards/{Guid.NewGuid()}");

        hidden.StatusCode.ShouldBe(missing.StatusCode);
        (await hidden.Content.ReadAsStringAsync()).ShouldBe(await missing.Content.ReadAsStringAsync());
        hidden.Content.Headers.ContentLength.ShouldBe(missing.Content.Headers.ContentLength);
    }

    [Test]
    public async Task A_board_from_before_users_existed_has_no_owner_and_is_visible_to_nobody()
    {
        foreach (var actor in new[] { "owner", "editor", "viewer", "stranger", "implicit-owner" })
        {
            (await ReadAsync(actor, _legacyBoard.Id)).ShouldBe(HttpStatusCode.NotFound, actor);
        }
    }

    [Test]
    public async Task Nobody_without_a_token_gets_past_the_policies()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.DeleteAsync($"/boards/{_board.Id}")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Duplicating_needs_read_and_the_copy_belongs_to_the_one_who_duplicated()
    {
        using var viewer = _factory.CreateAuthenticatedClient("viewer");
        using var stranger = _factory.CreateAuthenticatedClient("stranger");

        (await stranger.PostAsync($"/boards/{_board.Id}/duplicate", null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var response = await viewer.PostAsync($"/boards/{_board.Id}/duplicate", null);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var copy = (await response.Content.ReadFromJsonAsync<BoardDto>())!;
        (await viewer.GetAsync($"/boards/{copy.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.DeleteAsync($"/boards/{copy.Id}")).StatusCode
            .ShouldBe(HttpStatusCode.NoContent); // the duplicator owns the copy
        (await ReadAsync("owner", copy.Id)).ShouldBe(HttpStatusCode.NotFound); // the source's owner has no role on it
    }

    [Test]
    public async Task Creating_a_board_makes_the_creator_its_owner_and_only_the_creator_can_see_it()
    {
        using var creator = _factory.CreateAuthenticatedClient("newbie");

        var response = await creator.PostAsync("/boards", Json("Mine"));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = (await response.Content.ReadFromJsonAsync<BoardDto>())!;
        var (ownerSubject, memberships) = await InDatabaseAsync(async db =>
        {
            var board = await db.Boards.Include(b => b.Owner)
                .Include(b => b.Memberships)
                .SingleAsync(b => b.Id == created.Id);
            return (board.Owner!.Subject, board.Memberships.Select(m => (m.User, m.Role)).ToList());
        });
        ownerSubject.ShouldBe("newbie");
        memberships.ShouldHaveSingleItem().Role.ShouldBe(BoardRole.Owner);
        (await creator.DeleteAsync($"/boards/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var again =
            (await (await creator.PostAsync("/boards", Json("Mine again"))).Content.ReadFromJsonAsync<BoardDto>())!;
        (await ReadAsync("stranger", again.Id)).ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task The_list_holds_only_the_boards_of_the_caller()
    {
        async Task<string[]> NamesAsync(string actor)
        {
            using var client = _factory.CreateAuthenticatedClient(actor);
            return (await client.GetFromJsonAsync<BoardDto[]>("/boards"))!.Select(b => b.Name).ToArray();
        }

        (await NamesAsync("owner")).ShouldBe(["Retro"]);
        (await NamesAsync("editor")).ShouldBe(["Retro"]);
        (await NamesAsync("viewer")).ShouldBe(["Retro"]);
        (await NamesAsync("implicit-owner")).ShouldBe(["Implicit"]);
        (await NamesAsync("stranger")).ShouldBeEmpty(); // not the legacy board either
    }

    [TestCase("owner", "Owner")]
    [TestCase("editor", "Editor")]
    [TestCase("viewer", "Viewer")]
    public async Task My_membership_is_the_role_of_the_caller(string actor, string role)
    {
        using var client = _factory.CreateAuthenticatedClient(actor);

        var membership = await client.GetFromJsonAsync<MembershipDto>($"/boards/{_board.Id}/membership/me");

        membership.ShouldBe(new MembershipDto(_board.Id, role));
    }

    [Test]
    public async Task My_membership_of_the_board_I_own_by_id_alone_is_owner()
    {
        using var client = _factory.CreateAuthenticatedClient("implicit-owner");

        (await client.GetFromJsonAsync<MembershipDto>($"/boards/{_implicitOwnersBoard.Id}/membership/me"))!.Role
            .ShouldBe("Owner");
    }

    [Test]
    public async Task My_membership_is_404_for_non_members_and_unknown_boards_and_401_without_a_token()
    {
        using var stranger = _factory.CreateAuthenticatedClient("stranger");
        using var anonymous = _factory.CreateClient();

        (await stranger.GetAsync($"/boards/{_board.Id}/membership/me")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.GetAsync($"/boards/{Guid.NewGuid()}/membership/me")).StatusCode.ShouldBe(
            HttpStatusCode.NotFound);
        (await anonymous.GetAsync($"/boards/{_board.Id}/membership/me")).StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task A_renamed_board_keeps_its_name_when_the_caller_was_refused()
    {
        (await WriteAsync("viewer", _board.Id)).ShouldBe(HttpStatusCode.Forbidden);

        using var owner = _factory.CreateAuthenticatedClient("owner");
        (await owner.GetFromJsonAsync<BoardDto>($"/boards/{_board.Id}"))!.Name.ShouldBe("Retro");
    }

    [Test]
    public async Task A_refused_delete_leaves_the_board_in_place()
    {
        (await AdministerAsync("editor", _board.Id)).ShouldBe(HttpStatusCode.Forbidden);
        (await AdministerAsync("stranger", _board.Id)).ShouldBe(HttpStatusCode.NotFound);

        (await ReadAsync("owner", _board.Id)).ShouldBe(HttpStatusCode.OK);
    }
}
