using System.Security.Claims;

using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

using NSubstitute;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>
/// Both sources of a linked group's members at once (ADR 0027, #667): the token stays the source of truth, and a person Graph listed
/// before their first sign-in is a member as soon as they come.
/// </summary>
public class GraphAndTokenTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private const string External = "11111111-1111-4111-8111-111111111111";
    private SqliteDatabase _database = null!;
    private MemoryCache _cache = null!;
    private Guid _groupId;

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        _cache = new MemoryCache(new MemoryCacheOptions());
        var group = Group.Linked(Guid.CreateVersion7(), External, "Sales", Now);
        _groupId = group.Id;
        await using var db = _database.NewContext();
        db.Add(group);
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown()
    {
        _cache.Dispose();
        _database.Dispose();
    }

    private static ClaimsPrincipal Token(string subject, string email, params string[] groups) =>
        new(new ClaimsIdentity(
            new[] { new Claim("sub", subject), new Claim("email", email) }.Concat(groups.Select(g =>
                new Claim("groups", g))),
            "test"));

    private async Task<User> RequestAsync(ClaimsPrincipal principal,
        bool newCache = false,
        string groupsClaim = "groups")
    {
        if (newCache)
        {
            _cache.Dispose();
            _cache = new MemoryCache(new MemoryCacheOptions());
        }

        await using var db = _database.NewContext();
        var time = Substitute.For<TimeProvider>();
        time.GetUtcNow().Returns(Now);
        return (await UserProvisioningTests.Service(db, new UserRepository(db), time, _cache, groupsClaim)
            .ProvisionAsync(principal, Ct))!;
    }

    private async Task SyncFromGraphAsync(params GraphMember[] members)
    {
        await using var db = _database.NewContext();
        await new GroupSyncRepository(db).ApplyAsync(_groupId, null, members, Now, null, Ct);
    }

    private async Task<bool?> MembershipAsync(Guid userId)
    {
        await using var db = _database.NewContext();
        return (await db.GroupMemberships.AsNoTracking()
            .SingleOrDefaultAsync(m => m.UserId == userId && m.GroupId == _groupId))?.FromGraph;
    }

    [Test]
    public async Task
        A_person_Graph_listed_before_they_came_is_a_member_at_their_first_sign_in_when_the_token_lists_the_group_too()
    {
        await SyncFromGraphAsync(new GraphMember("o1", "Zoe", "zoe@example.com", null));

        var zoe = await RequestAsync(Token("kc-zoe", "Zoe@Example.com", External));

        // The token's claim made it the token's own membership; nothing is pending any more.
        (await MembershipAsync(zoe.Id)).ShouldBe(false);
        await using var db = _database.NewContext();
        (await db.PendingGroupMemberships.CountAsync()).ShouldBe(0);
    }

    [Test]
    public async Task
        A_person_Graph_listed_before_they_came_is_a_member_at_their_first_sign_in_when_no_token_decides_the_groups()
    {
        await SyncFromGraphAsync(new GraphMember("o1", "Zoe", "zoe@example.com", null));

        // OIDC_GROUPS_CLAIM is empty: no token changes any membership, so what the directory said is what counts.
        var zoe = await RequestAsync(Token("kc-zoe", "zoe@example.com"), groupsClaim: "");

        (await MembershipAsync(zoe.Id)).ShouldBe(true);
        await using var db = _database.NewContext();
        (await db.PendingGroupMemberships.CountAsync()).ShouldBe(0);
    }

    [Test]
    public async Task At_a_first_sign_in_the_token_wins_over_the_pending_entry_when_it_does_not_list_the_group()
    {
        await SyncFromGraphAsync(new GraphMember("o1", "Zoe", "zoe@example.com", null));

        var zoe = await RequestAsync(Token("kc-zoe", "zoe@example.com"));

        // The brokered login that just happened is the freshest word of the directory: no group in it, no membership.
        (await MembershipAsync(zoe.Id)).ShouldBeNull();
    }

    [Test]
    public async Task The_token_wins_a_membership_it_denies_is_removed_even_though_Graph_listed_it()
    {
        var ann = await RequestAsync(Token("kc-ann", "ann@example.com"));
        await SyncFromGraphAsync(new GraphMember("o1", "Ann", "ann@example.com", null));
        (await MembershipAsync(ann.Id)).ShouldBe(true);

        // Her next token (a new compare) does not list the group: the token is fresher, so the membership goes.
        await RequestAsync(Token("kc-ann", "ann@example.com", "another-group"), newCache: true);

        (await MembershipAsync(ann.Id)).ShouldBeNull();
    }

    [Test]
    public async Task A_membership_the_token_lists_stays_when_the_directory_drops_the_person()
    {
        var ann = await RequestAsync(Token("kc-ann", "ann@example.com"));
        await SyncFromGraphAsync(new GraphMember("o1", "Ann", "ann@example.com", null));
        await RequestAsync(Token("kc-ann", "ann@example.com", External), newCache: true);
        (await MembershipAsync(ann.Id)).ShouldBe(false); // the token's now

        await SyncFromGraphAsync(); // the directory lists nobody

        (await MembershipAsync(ann.Id)).ShouldBe(false);
    }

    [Test]
    public async Task A_change_that_only_confirms_a_membership_writes_no_audit_entry()
    {
        var ann = await RequestAsync(Token("kc-ann", "ann@example.com"));
        await SyncFromGraphAsync(new GraphMember("o1", "Ann", "ann@example.com", null));

        await RequestAsync(Token("kc-ann", "ann@example.com", External), newCache: true);

        await using var db = _database.NewContext();
        (await db.AuditEntries.CountAsync(e => e.SubjectId == ann.Id && e.Action == "groups.synced")).ShouldBe(0);
    }

    [Test]
    public async Task A_person_without_an_email_is_never_matched_to_pending_entries()
    {
        await SyncFromGraphAsync(new GraphMember("o1", "Zoe", "zoe@example.com", null));
        await using var db = _database.NewContext();
        var time = Substitute.For<TimeProvider>();
        time.GetUtcNow().Returns(Now);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "kc-nomail")], "test"));

        var user = await UserProvisioningTests.Service(db, new UserRepository(db), time, _cache)
            .ProvisionAsync(principal, Ct);

        (await MembershipAsync(user!.Id)).ShouldBeNull();
        (await db.PendingGroupMemberships.CountAsync()).ShouldBe(1);
    }
}
