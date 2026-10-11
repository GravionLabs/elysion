using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>What the Graph sync writes for one linked group (#667), on a real relational database.</summary>
public class GroupSyncRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private const string External = "11111111-1111-4111-8111-111111111111";
    private SqliteDatabase _database = null!;
    private Group _group = null!;
    private User _ann = null!;
    private User _bob = null!;

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        _group = Group.Linked(Guid.CreateVersion7(), External, External, Now);
        _ann = User.Create(Guid.CreateVersion7(), "kc-ann", "Ann", "ann@example.com", Now);
        _bob = User.Create(Guid.CreateVersion7(), "kc-bob", "Bob", "bob@example.com", Now);
        await using var db = _database.NewContext();
        db.AddRange(_group, _ann, _bob);
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static GraphMember Person(string mail, string? name = null) => new($"oid-{mail}", name ?? mail, mail, mail);

    private async Task<GroupSyncResult> ApplyAsync(string? name, params GraphMember[] members)
    {
        await using var db = _database.NewContext();
        return await new GroupSyncRepository(db).ApplyAsync(_group.Id, name, members, Now, null, Ct);
    }

    private async Task<List<(string User, bool FromGraph)>> MembersAsync()
    {
        await using var db = _database.NewContext();
        return (await db.GroupMemberships.Where(m => m.GroupId == _group.Id)
                .Select(m => new { m.User!.DisplayName, m.FromGraph })
                .OrderBy(m => m.DisplayName)
                .ToListAsync(Ct))
            .Select(m => (m.DisplayName, m.FromGraph))
            .ToList();
    }

    private async Task<string[]> PendingAsync()
    {
        await using var db = _database.NewContext();
        return await db.PendingGroupMemberships.Where(p => p.GroupId == _group.Id)
            .OrderBy(p => p.Email)
            .Select(p => p.Email)
            .ToArrayAsync(Ct);
    }

    [Test]
    public async Task Known_people_get_a_membership_and_unknown_ones_become_pending_by_their_lower_case_address()
    {
        var result = await ApplyAsync("Sales", Person("Ann@Example.com"), Person("Zoe@Example.com", "Zoe"));

        result.ShouldBe(new GroupSyncResult(true, 1, 0, 1, 0));
        (await MembersAsync()).ShouldBe([("Ann", true)]);
        (await PendingAsync()).ShouldBe(["zoe@example.com"]);
        await using var db = _database.NewContext();
        (await db.Groups.SingleAsync(g => g.Id == _group.Id)).GraphSyncedAt.ShouldBe(Now);
        (await db.PendingGroupMemberships.SingleAsync()).DisplayName.ShouldBe("Zoe");
    }

    [Test]
    public async Task A_second_run_with_the_same_directory_changes_nothing()
    {
        await ApplyAsync("Sales", Person("ann@example.com"), Person("zoe@example.com"));

        var second = await ApplyAsync("Sales", Person("ann@example.com"), Person("zoe@example.com"));

        second.Changed.ShouldBeFalse();
        (await MembersAsync()).Count.ShouldBe(1);
        (await PendingAsync()).Length.ShouldBe(1);
    }

    [Test]
    public async Task A_person_the_directory_drops_loses_the_membership_the_sync_made_and_the_pending_entry()
    {
        await ApplyAsync(null, Person("ann@example.com"), Person("bob@example.com"), Person("zoe@example.com"));

        var result = await ApplyAsync(null, Person("bob@example.com"));

        result.ShouldBe(new GroupSyncResult(false, 0, 1, 0, 1));
        (await MembersAsync()).ShouldBe([("Bob", true)]);
        (await PendingAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_membership_from_a_token_or_an_administrator_is_not_taken_away_by_the_sync()
    {
        await using (var db = _database.NewContext())
        {
            db.GroupMemberships.Add(GroupMembership.Create(_group.Id, _bob.Id, Now)); // FromGraph false
            await db.SaveChangesAsync();
        }

        await ApplyAsync(null, Person("ann@example.com"));

        (await MembersAsync()).ShouldBe([("Ann", true), ("Bob", false)]);
    }

    [Test]
    public async Task A_deactivated_person_gets_no_membership_and_no_pending_entry()
    {
        await using (var db = _database.NewContext())
        {
            var bob = await db.Users.SingleAsync(u => u.Id == _bob.Id);
            bob.DeactivatedAt = Now;
            await db.SaveChangesAsync();
        }

        await ApplyAsync(null, Person("bob@example.com"));

        (await MembersAsync()).ShouldBeEmpty();
        (await PendingAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_person_without_an_address_cannot_be_matched_and_is_skipped()
    {
        var result = await ApplyAsync(null, new GraphMember("oid-1", "No Mail", null, "plain-name"));

        result.Changed.ShouldBeFalse();
    }

    [Test]
    public async Task
        The_directory_names_a_group_that_still_has_its_id_as_name_and_follows_its_renames_until_an_administrator_names_it()
    {
        (await ApplyAsync("Sales", [])).Renamed.ShouldBeTrue();
        (await GroupAsync()).Name.ShouldBe("Sales");
        (await GroupAsync()).NameFromProvider.ShouldBeTrue();

        (await ApplyAsync("Sales EMEA", [])).Renamed.ShouldBeTrue();
        (await GroupAsync()).Name.ShouldBe("Sales EMEA");

        await using (var db = _database.NewContext())
        {
            (await db.Groups.SingleAsync(g => g.Id == _group.Id)).Rename("Our sales");
            await db.SaveChangesAsync();
        }

        (await ApplyAsync("Sales Worldwide", [])).Renamed.ShouldBeFalse();
        var group = await GroupAsync();
        group.Name.ShouldBe("Our sales");
        group.NameFromProvider.ShouldBeFalse();
    }

    [Test]
    public async Task A_name_that_does_not_fit_is_ignored()
    {
        (await ApplyAsync(new string('x', 200), [])).Renamed.ShouldBeFalse();
        (await ApplyAsync("  ", [])).Renamed.ShouldBeFalse();
        (await GroupAsync()).Name.ShouldBe(External);
    }

    [Test]
    public async Task The_result_is_reported_before_it_is_saved_so_that_an_audit_entry_goes_into_the_same_commit()
    {
        GroupSyncResult? seen = null;
        await using var db = _database.NewContext();

        await new GroupSyncRepository(db).ApplyAsync(_group.Id,
            null,
            [Person("ann@example.com")],
            Now,
            r => seen = r,
            Ct);

        seen.ShouldNotBeNull();
        seen.Added.ShouldBe(1);
    }

    [Test]
    public async Task A_first_sign_in_turns_the_pending_entries_of_the_address_into_memberships()
    {
        await ApplyAsync(null, Person("zoe@example.com"));
        var zoe = User.Create(Guid.CreateVersion7(), "kc-zoe", "Zoe", "Zoe@Example.com", Now);
        await using (var db = _database.NewContext())
        {
            db.Users.Add(zoe);
            await db.SaveChangesAsync();
        }

        await using (var db = _database.NewContext())
        {
            (await new GroupSyncRepository(db).AdoptPendingAsync(zoe.Id, "Zoe@Example.com", Now, Ct)).ShouldBe(1);
        }

        (await MembersAsync()).ShouldBe([("Zoe", true)]);
        (await PendingAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task Adoption_without_a_matching_pending_entry_does_nothing()
    {
        await using var db = _database.NewContext();

        (await new GroupSyncRepository(db).AdoptPendingAsync(_ann.Id, "ann@example.com", Now, Ct)).ShouldBe(0);
        (await new GroupSyncRepository(db).AdoptPendingAsync(_ann.Id, " ", Now, Ct)).ShouldBe(0);
    }

    [Test]
    public async Task Only_linked_groups_with_a_GUID_id_are_listed_for_the_sync()
    {
        await using (var db = _database.NewContext())
        {
            db.Groups.Add(Group.Linked(Guid.CreateVersion7(), "not-a-guid", "Odd", Now));
            db.Groups.Add(Group.Create(Guid.CreateVersion7(), "Local", Now));
            await db.SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        (await new GroupSyncRepository(read).ListLinkedAsync(Ct)).Select(g => g.ExternalId).ShouldBe([External]);
    }

    [Test]
    public async Task Deleting_the_group_removes_its_pending_entries()
    {
        await ApplyAsync(null, Person("zoe@example.com"));
        await using var db = _database.NewContext();

        db.Groups.Remove(await db.Groups.SingleAsync(g => g.Id == _group.Id));
        await db.SaveChangesAsync();

        (await db.PendingGroupMemberships.CountAsync()).ShouldBe(0);
    }

    private async Task<Group> GroupAsync()
    {
        await using var db = _database.NewContext();
        return await db.Groups.AsNoTracking().SingleAsync(g => g.Id == _group.Id);
    }
}
