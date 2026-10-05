using System.Security.Claims;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// The provisioning service against SQLite, which enforces the unique index on <c>Subject</c>: the
/// concurrency rule is the point of these tests. Every call gets a new context, like a new request.
/// </summary>
public class UserProvisioningTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private SqliteDatabase _database = null!;

    [SetUp]
    public void SetUp() => _database = new SqliteDatabase();

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static ClaimsPrincipal Principal(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), "test"));

    private async Task<User?> ProvisionAsync(ClaimsPrincipal principal, Func<ElysionDbContext, IUserRepository>? repository = null)
    {
        await using var db = _database.NewContext();
        var time = Substitute.For<TimeProvider>();
        time.GetUtcNow().Returns(Now);
        var service = new UserProvisioningService(repository?.Invoke(db) ?? new UserRepository(db), db, time);
        return await service.ProvisionAsync(principal, Ct);
    }

    private async Task<List<User>> AllUsersAsync()
    {
        await using var db = _database.NewContext();
        return await db.Users.AsNoTracking().ToListAsync(Ct);
    }

    [Test]
    public async Task A_new_subject_creates_exactly_one_user_with_the_mapped_claims()
    {
        var user = await ProvisionAsync(Principal(("sub", "kc-1"), ("email", "ada@example.com"), ("preferred_username", "ada")));

        var stored = (await AllUsersAsync()).ShouldHaveSingleItem();
        stored.Id.ShouldBe(user!.Id);
        (stored.Subject, stored.Email, stored.DisplayName, stored.CreatedAt).ShouldBe(("kc-1", "ada@example.com", "ada", Now));
    }

    [Test]
    public async Task The_same_subject_again_is_the_same_user_and_a_changed_email_or_name_updates_it()
    {
        var first = await ProvisionAsync(Principal(("sub", "kc-1"), ("email", "old@example.com"), ("preferred_username", "ada")));

        var second = await ProvisionAsync(Principal(("sub", "kc-1"), ("email", "new@example.com"), ("preferred_username", "ada.l")));

        second!.Id.ShouldBe(first!.Id);
        var stored = (await AllUsersAsync()).ShouldHaveSingleItem();
        (stored.Email, stored.DisplayName).ShouldBe(("new@example.com", "ada.l"));
        stored.CreatedAt.ShouldBe(Now);
    }

    [Test]
    public async Task Unchanged_claims_write_nothing()
    {
        var principal = Principal(("sub", "kc-1"), ("email", "ada@example.com"), ("preferred_username", "ada"));
        await ProvisionAsync(principal);
        await using var db = _database.NewContext();
        var unitOfWork = Substitute.For<IUnitOfWork>();
        var service = new UserProvisioningService(new UserRepository(db), unitOfWork, TimeProvider.System);

        await service.ProvisionAsync(principal, Ct);

        await unitOfWork.DidNotReceive().SaveChangesAsync(Arg.Any<CancellationToken>());
    }

    [TestCase("preferred_username", "ada", "ada")]
    [TestCase("name", "Ada Lovelace", "Ada Lovelace")]
    public async Task The_display_name_comes_from_preferred_username_then_name(string claim, string value, string expected)
    {
        await ProvisionAsync(Principal(("sub", "kc-1"), (claim, value)));

        (await AllUsersAsync()).Single().DisplayName.ShouldBe(expected);
    }

    [Test]
    public async Task Preferred_username_wins_over_name()
    {
        await ProvisionAsync(Principal(("sub", "kc-1"), ("name", "Ada Lovelace"), ("preferred_username", "ada")));

        (await AllUsersAsync()).Single().DisplayName.ShouldBe("ada");
    }

    [Test]
    public async Task Missing_optional_claims_do_not_throw_and_the_display_name_falls_back_to_email_then_subject()
    {
        await ProvisionAsync(Principal(("sub", "kc-1"), ("email", "ada@example.com")));
        await ProvisionAsync(Principal(("sub", "kc-2")));

        var users = (await AllUsersAsync()).ToDictionary(u => u.Subject);
        users["kc-1"].DisplayName.ShouldBe("ada@example.com");
        users["kc-2"].DisplayName.ShouldBe("kc-2");
        users["kc-2"].Email.ShouldBeNull();
    }

    [Test]
    public async Task A_principal_without_a_subject_is_not_provisioned()
    {
        (await ProvisionAsync(Principal(("email", "ada@example.com")))).ShouldBeNull();
        (await ProvisionAsync(Principal(("sub", "  ")))).ShouldBeNull();

        (await AllUsersAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_subject_longer_than_the_model_keeps_is_refused_and_not_stored_cut()
    {
        (await ProvisionAsync(Principal(("sub", new string('s', User.MaxSubjectLength + 1))))).ShouldBeNull();

        (await AllUsersAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task Overlong_names_and_emails_are_cut_to_what_the_model_keeps()
    {
        await ProvisionAsync(Principal(
            ("sub", "kc-1"),
            ("preferred_username", new string('n', User.MaxDisplayNameLength + 50)),
            ("email", new string('e', User.MaxEmailLength + 50))));

        var stored = (await AllUsersAsync()).Single();
        stored.DisplayName.Length.ShouldBe(User.MaxDisplayNameLength);
        stored.Email!.Length.ShouldBe(User.MaxEmailLength);
    }

    /// <summary>The lookup of a request that did not see the row another request inserted a moment earlier.</summary>
    private sealed class StaleLookupRepository(IUserRepository inner) : IUserRepository
    {
        public Task<User?> FindBySubjectForUpdateAsync(string subject, CancellationToken cancellationToken) =>
            Task.FromResult<User?>(null);

        public Task<User> GetOrAddAsync(User user, CancellationToken cancellationToken) =>
            inner.GetOrAddAsync(user, cancellationToken);
    }

    [Test]
    public async Task Two_first_requests_of_the_same_person_resolve_to_one_row()
    {
        var winner = await ProvisionAsync(Principal(("sub", "kc-1"), ("preferred_username", "ada")));

        // The second request looked before the first one inserted, so it tries to insert too and loses on the unique index.
        var loser = await ProvisionAsync(
            Principal(("sub", "kc-1"), ("preferred_username", "ada")),
            db => new StaleLookupRepository(new UserRepository(db)));

        loser!.Id.ShouldBe(winner!.Id);
        (await AllUsersAsync()).ShouldHaveSingleItem();
    }

    [Test]
    public async Task The_loser_of_the_race_still_updates_the_claims_of_the_winners_row()
    {
        await ProvisionAsync(Principal(("sub", "kc-1"), ("email", "old@example.com")));

        await ProvisionAsync(
            Principal(("sub", "kc-1"), ("email", "new@example.com")),
            db => new StaleLookupRepository(new UserRepository(db)));

        (await AllUsersAsync()).Single().Email.ShouldBe("new@example.com");
    }

    [Test]
    public async Task Real_parallel_first_requests_end_with_one_row()
    {
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Task.Run(() => ProvisionAsync(Principal(("sub", "kc-1"), ("preferred_username", "ada"))))));

        results.Select(u => u!.Id).Distinct().Count().ShouldBe(1);
        (await AllUsersAsync()).ShouldHaveSingleItem();
    }

    [Test]
    public async Task A_failed_insert_that_is_not_the_race_is_not_swallowed()
    {
        await using var db = _database.NewContext();
        var repository = new UserRepository(db);
        // A subject over the column limit is not enforced by SQLite; a duplicate primary key fails differently.
        var user = User.Create(Guid.CreateVersion7(), "kc-1", "ada", null, Now);
        await repository.GetOrAddAsync(user, Ct);

        await using var other = _database.NewContext();
        var clash = User.Create(user.Id, "kc-other", "bob", null, Now); // same Id, different subject

        await Should.ThrowAsync<DbUpdateException>(() => new UserRepository(other).GetOrAddAsync(clash, Ct));
    }
}
