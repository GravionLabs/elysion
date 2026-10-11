using System.Security.Claims;

using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

using NSubstitute;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Groups;

/// <summary>The memberships in linked groups follow the <c>groups</c> claim of the token (ADR 0027), through the provisioning service.</summary>
public class GroupClaimSyncTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private SqliteDatabase _database = null!;
    private MemoryCache _cache = null!;

    [SetUp]
    public void SetUp()
    {
        _database = new SqliteDatabase();
        _cache = new MemoryCache(new MemoryCacheOptions());
    }

    [TearDown]
    public void TearDown()
    {
        _cache.Dispose();
        _database.Dispose();
    }

    private static ClaimsPrincipal Token(string subject, params string[] groups) =>
        new(new ClaimsIdentity(
            new[] { new Claim("sub", subject) }.Concat(groups.Select(g => new Claim("groups", g))),
            "test"));

    private async Task<User> RequestAsync(ClaimsPrincipal principal, string claimName = "groups", bool newCache = false)
    {
        if (newCache)
        {
            _cache.Dispose();
            _cache = new MemoryCache(new MemoryCacheOptions());
        }

        await using var db = _database.NewContext();
        var time = Substitute.For<TimeProvider>();
        time.GetUtcNow().Returns(Now);
        var service = UserProvisioningTests.Service(db, new UserRepository(db), time, _cache, claimName);
        return (await service.ProvisionAsync(principal, Ct))!;
    }

    private async Task<string[]> LinkedGroupsOfAsync(Guid userId)
    {
        await using var db = _database.NewContext();
        return await db.GroupMemberships
            .Where(m => m.UserId == userId && m.Group!.Source == GroupSource.IdentityProvider)
            .Select(m => m.Group!.ExternalId!)
            .OrderBy(id => id)
            .ToArrayAsync(Ct);
    }

    [Test]
    public async Task The_first_request_creates_the_groups_of_the_claim_and_the_memberships()
    {
        var user = await RequestAsync(Token("kc-1", "oid-b", "oid-a"));

        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-a", "oid-b"]);
    }

    [Test]
    public async Task A_changed_claim_adds_and_removes_memberships()
    {
        var user = await RequestAsync(Token("kc-1", "oid-a", "oid-b"));

        await RequestAsync(Token("kc-1", "oid-b", "oid-c"));

        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-b", "oid-c"]);
    }

    [Test]
    public async Task The_same_claim_again_does_not_ask_the_database_at_all()
    {
        var user = await RequestAsync(Token("kc-1", "oid-a"));
        // Take the membership away behind the service's back: a request that really synced would give it back.
        await using (var db = _database.NewContext())
        {
            await db.GroupMemberships.ExecuteDeleteAsync(Ct);
        }

        await RequestAsync(Token("kc-1", "oid-a"));
        (await LinkedGroupsOfAsync(user.Id)).ShouldBeEmpty();

        // Once the person is not remembered any more (another instance, a restart, an hour later), the next request repairs it.
        await RequestAsync(Token("kc-1", "oid-a"), newCache: true);
        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-a"]);
    }

    [Test]
    public async Task The_order_and_repeats_in_the_claim_do_not_matter()
    {
        var user = await RequestAsync(Token("kc-1", "oid-b", "oid-a", "oid-a", " oid-b "));

        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-a", "oid-b"]);
    }

    [Test]
    public async Task Local_memberships_survive_every_change_of_the_claim()
    {
        var user = await RequestAsync(Token("kc-1", "oid-a"));
        var local = Group.Create(Guid.CreateVersion7(), "Friends", Now);
        await using (var db = _database.NewContext())
        {
            db.AddRange(local, GroupMembership.Create(local.Id, user.Id, Now));
            await db.SaveChangesAsync(Ct);
        }

        await RequestAsync(Token("kc-1"));

        (await LinkedGroupsOfAsync(user.Id)).ShouldBeEmpty();
        await using var read = _database.NewContext();
        (await read.GroupMemberships.CountAsync(m => m.GroupId == local.Id, Ct)).ShouldBe(1);
    }

    [Test]
    public async Task A_token_without_the_claim_means_no_linked_groups_while_the_setting_is_on()
    {
        var user = await RequestAsync(Token("kc-1", "oid-a"));

        await RequestAsync(Token("kc-1"));

        (await LinkedGroupsOfAsync(user.Id)).ShouldBeEmpty();
    }

    [Test]
    public async Task With_an_empty_setting_no_token_changes_a_membership()
    {
        var user = await RequestAsync(Token("kc-1", "oid-a"));

        await RequestAsync(Token("kc-1"), claimName: "", newCache: true);
        await RequestAsync(Token("kc-1", "oid-z"), claimName: "", newCache: true);

        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-a"]);
    }

    [Test]
    public async Task The_claim_can_have_another_name()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", "kc-1"), new Claim("roles_of_company", "oid-a")],
            "test"));

        var user = await RequestAsync(principal, claimName: "roles_of_company");

        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-a"]);
    }

    [Test]
    public async Task A_value_that_is_empty_or_longer_than_255_characters_is_left_out_not_cut()
    {
        var tooLong = new string('x', 256);

        var user = await RequestAsync(Token("kc-1", "oid-a", "   ", tooLong));

        (await LinkedGroupsOfAsync(user.Id)).ShouldBe(["oid-a"]);
    }

    [Test]
    public async Task A_token_with_far_too_many_groups_gets_the_first_500_in_order()
    {
        var ids = Enumerable.Range(0, 600).Select(i => $"oid-{i:D4}").ToArray();

        var user = await RequestAsync(Token("kc-1", ids));

        var stored = await LinkedGroupsOfAsync(user.Id);
        stored.Length.ShouldBe(UserProvisioningService.MaxGroupsPerToken);
        stored[0].ShouldBe("oid-0000");
    }

    [Test]
    public async Task Two_people_with_the_same_group_in_their_tokens_share_one_group_row()
    {
        await RequestAsync(Token("kc-1", "oid-a"));
        await RequestAsync(Token("kc-2", "oid-a"));

        await using var db = _database.NewContext();
        (await db.Groups.CountAsync(Ct)).ShouldBe(1);
        (await db.GroupMemberships.CountAsync(Ct)).ShouldBe(2);
    }
}
