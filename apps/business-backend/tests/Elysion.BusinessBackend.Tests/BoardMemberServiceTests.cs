using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Members;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The last-owner rule, which the HTTP tests cannot reach: it matters only for a board without a creator.</summary>
public class BoardMemberServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private SqliteDatabase _database = null!;
    private User _ada = null!;
    private User _bea = null!;
    private Board _board = null!;

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        _ada = User.Create(Guid.CreateVersion7(), "ada", "Ada", "ada@example.com", Now);
        _bea = User.Create(Guid.CreateVersion7(), "bea", "Bea", "bea@example.com", Now);
        _board = Board.Create(Guid.CreateVersion7(), "No creator", Now); // no OwnerId: the owners are the Owner memberships
        await using var db = _database.NewContext();
        db.AddRange(_ada, _bea, _board, BoardMembership.Create(_board.Id, _ada.Id, BoardRole.Owner, Now));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private async Task<T> WithServiceAsync<T>(Func<BoardMemberService, Task<T>> action)
    {
        await using var db = _database.NewContext();
        var service = new BoardMemberService(new BoardRepository(db), new MembershipRepository(db), new UserRepository(db), db, TimeProvider.System);
        return await action(service);
    }

    [Test]
    public async Task The_last_owner_cannot_be_demoted_or_removed()
    {
        (await WithServiceAsync(s => s.ChangeRoleAsync(_board.Id, _ada.Id, BoardRole.Editor, Ct))).Outcome.ShouldBe(MemberOutcome.LastOwner);
        (await WithServiceAsync(s => s.RemoveAsync(_board.Id, _ada.Id, Ct))).Outcome.ShouldBe(MemberOutcome.LastOwner);

        (await WithServiceAsync(s => s.ListAsync(_board.Id, Ct))).ShouldHaveSingleItem().Role.ShouldBe(BoardRole.Owner);
    }

    [Test]
    public async Task Setting_the_last_owner_to_owner_again_is_not_a_demotion()
    {
        (await WithServiceAsync(s => s.ChangeRoleAsync(_board.Id, _ada.Id, BoardRole.Owner, Ct))).Succeeded.ShouldBeTrue();
    }

    [Test]
    public async Task With_a_second_owner_either_can_be_demoted_but_not_both()
    {
        await WithServiceAsync(s => s.AddAsync(_board.Id, "bea@example.com", BoardRole.Owner, Ct));

        (await WithServiceAsync(s => s.ChangeRoleAsync(_board.Id, _ada.Id, BoardRole.Viewer, Ct))).Succeeded.ShouldBeTrue();
        (await WithServiceAsync(s => s.RemoveAsync(_board.Id, _bea.Id, Ct))).Outcome.ShouldBe(MemberOutcome.LastOwner);
        (await WithServiceAsync(s => s.ChangeRoleAsync(_board.Id, _bea.Id, BoardRole.Editor, Ct))).Outcome.ShouldBe(MemberOutcome.LastOwner);
    }

    [Test]
    public async Task Two_users_with_the_same_email_make_an_invitation_ambiguous_instead_of_a_guess()
    {
        await using (var db = _database.NewContext())
        {
            db.Add(User.Create(Guid.CreateVersion7(), "ada-2", "Ada again", "ADA@example.com", Now));
            await db.SaveChangesAsync();
        }
        var other = Board.Create(Guid.CreateVersion7(), "Other", Now);
        await using (var db = _database.NewContext())
        {
            db.Add(other);
            await db.SaveChangesAsync();
        }

        (await WithServiceAsync(s => s.AddAsync(other.Id, "ada@example.com", BoardRole.Viewer, Ct))).Outcome.ShouldBe(MemberOutcome.AmbiguousEmail);
    }

    [Test]
    public async Task Adding_by_email_finds_the_user_without_regard_to_case_on_a_relational_database()
    {
        var result = await WithServiceAsync(s => s.AddAsync(_board.Id, " BEA@Example.com ", BoardRole.Viewer, Ct));

        result.Outcome.ShouldBe(MemberOutcome.Done);
        result.Member!.UserId.ShouldBe(_bea.Id);
        await using var db = _database.NewContext();
        (await db.BoardMemberships.CountAsync(m => m.BoardId == _board.Id)).ShouldBe(2);
    }
}
