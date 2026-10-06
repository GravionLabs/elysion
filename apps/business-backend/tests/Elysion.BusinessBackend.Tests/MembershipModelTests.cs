using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// The users and memberships model against SQLite in memory, a relational provider: the EF in-memory provider
/// does not enforce unique indexes or foreign keys, which are the point of these tests.
/// </summary>
public class MembershipModelTests
{
    private SqliteConnection _connection = null!;

    [SetUp]
    public void SetUp()
    {
        _connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=True");
        _connection.Open(); // the database lives as long as this connection
        using var context = NewContext();
        context.Database.EnsureCreated();
    }

    [TearDown]
    public void TearDown() => _connection.Dispose();

    private ElysionDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ElysionDbContext>().UseSqlite(_connection).Options);

    private static User NewUser(string subject = "kc-sub-1") =>
        User.Create(Guid.CreateVersion7(), subject, subject, $"{subject}@example.com", DateTimeOffset.UtcNow);

    private static Board NewBoard(User? owner = null) =>
        Board.Create(Guid.CreateVersion7(), "Retro", DateTimeOffset.UtcNow, owner?.Id);

    private static BoardMembership Membership(Board board, User user, BoardRole role) =>
        BoardMembership.Create(board.Id, user.Id, role, DateTimeOffset.UtcNow);

    [Test]
    public async Task A_user_can_be_created_and_made_owner_of_a_board()
    {
        var user = NewUser();
        var board = NewBoard(user);
        await using (var context = NewContext())
        {
            context.AddRange(user, board, Membership(board, user, BoardRole.Owner));
            await context.SaveChangesAsync();
        }

        await using var read = NewContext();
        var stored = await read.Boards.Include(b => b.Owner).Include(b => b.Memberships).SingleAsync();
        stored.Owner!.Subject.ShouldBe("kc-sub-1");
        stored.Memberships.Single().Role.ShouldBe(BoardRole.Owner);
        (await read.Users.Include(u => u.Memberships).SingleAsync()).Memberships.Count.ShouldBe(1);
    }

    [Test]
    public async Task A_user_cannot_hold_two_roles_on_one_board()
    {
        var user = NewUser();
        var board = NewBoard(user);
        await using var context = NewContext();
        context.AddRange(user, board, Membership(board, user, BoardRole.Owner));
        await context.SaveChangesAsync();

        await using var second = NewContext();
        second.Add(Membership(board, user, BoardRole.Viewer));

        await Should.ThrowAsync<DbUpdateException>(() => second.SaveChangesAsync());
    }

    [Test]
    public async Task Different_users_can_share_a_board_and_one_user_can_be_on_several_boards()
    {
        var ada = NewUser("ada");
        var bea = NewUser("bea");
        var first = NewBoard(ada);
        var second = NewBoard(ada);
        await using var context = NewContext();
        context.AddRange(
            ada,
            bea,
            first,
            second,
            Membership(first, ada, BoardRole.Owner),
            Membership(first, bea, BoardRole.Viewer),
            Membership(second, ada, BoardRole.Owner));

        await context.SaveChangesAsync();

        (await context.BoardMemberships.CountAsync()).ShouldBe(3);
    }

    [Test]
    public async Task Two_users_cannot_share_an_identity_provider_subject()
    {
        await using var context = NewContext();
        context.Add(NewUser("same"));
        await context.SaveChangesAsync();

        await using var other = NewContext();
        other.Add(NewUser("same"));

        await Should.ThrowAsync<DbUpdateException>(() => other.SaveChangesAsync());
    }

    [Test]
    public async Task A_role_is_stored_as_its_name()
    {
        var user = NewUser();
        var board = NewBoard(user);
        await using (var context = NewContext())
        {
            context.AddRange(user, board, Membership(board, user, BoardRole.Editor));
            await context.SaveChangesAsync();
        }

        await using var command = _connection.CreateCommand();
        command.CommandText = "SELECT \"Role\" FROM \"BoardMemberships\"";

        (await command.ExecuteScalarAsync()).ShouldBe("Editor");
    }

    [Test]
    public async Task A_membership_needs_an_existing_board_and_user()
    {
        await using var context = NewContext();
        context.Add(new BoardMembership { BoardId = Guid.NewGuid(), UserId = Guid.NewGuid(), Role = BoardRole.Viewer });

        await Should.ThrowAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Test]
    public async Task Deleting_a_board_removes_its_memberships_but_not_its_users()
    {
        var user = NewUser();
        var board = NewBoard(user);
        await using var context = NewContext();
        context.AddRange(user, board, Membership(board, user, BoardRole.Owner));
        await context.SaveChangesAsync();

        context.Remove(board);
        await context.SaveChangesAsync();

        (await context.BoardMemberships.CountAsync()).ShouldBe(0);
        (await context.Users.CountAsync()).ShouldBe(1);
    }

    [Test]
    public async Task Deleting_a_user_removes_their_memberships_and_leaves_their_boards_without_an_owner()
    {
        var user = NewUser();
        var board = NewBoard(user);
        await using var context = NewContext();
        context.AddRange(user, board, Membership(board, user, BoardRole.Owner));
        await context.SaveChangesAsync();

        context.Remove(user);
        await context.SaveChangesAsync();

        await using var read = NewContext();
        (await read.BoardMemberships.CountAsync()).ShouldBe(0);
        (await read.Boards.SingleAsync()).OwnerId.ShouldBeNull();
    }

    [Test]
    public async Task A_board_without_an_owner_is_valid_like_one_from_before_users_existed()
    {
        await using var context = NewContext();
        context.Add(NewBoard());

        await context.SaveChangesAsync();

        (await context.Boards.SingleAsync()).OwnerId.ShouldBeNull();
    }
}
