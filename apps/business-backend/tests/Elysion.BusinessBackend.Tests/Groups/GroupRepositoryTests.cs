using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Groups;

public class GroupRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private SqliteDatabase _database = null!;

    [SetUp]
    public void SetUp() => _database = new SqliteDatabase();

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static User NewUser(string subject) => User.Create(Guid.CreateVersion7(), subject, subject, null, Now);

    private async Task SeedAsync(params object[] entities)
    {
        await using var db = _database.NewContext();
        db.AddRange(entities);
        await db.SaveChangesAsync();
    }

    private async Task<List<(string Name, GroupSource Source)>> GroupsOfAsync(Guid userId)
    {
        await using var db = _database.NewContext();
        var groups = await new GroupRepository(db).GetForUserAsync(userId, Ct);
        return groups.Select(g => (g.Name, g.Source)).ToList();
    }

    private async Task<bool> SetAsync(Guid userId, params string[] ids)
    {
        await using var db = _database.NewContext();
        return await new GroupRepository(db).SetLinkedMembershipsAsync(userId, ids, Now, null, Ct);
    }

    [Test]
    public async Task The_first_set_creates_the_linked_groups_named_after_their_ids_and_the_memberships()
    {
        var ada = NewUser("ada");
        await SeedAsync(ada);

        (await SetAsync(ada.Id, "oid-b", "oid-a")).ShouldBeTrue();

        (await GroupsOfAsync(ada.Id)).ShouldBe([
            ("oid-a", GroupSource.IdentityProvider), ("oid-b", GroupSource.IdentityProvider)
        ]);
    }

    [Test]
    public async Task The_same_set_again_changes_nothing()
    {
        var ada = NewUser("ada");
        await SeedAsync(ada);
        await SetAsync(ada.Id, "oid-a", "oid-b");

        (await SetAsync(ada.Id, "oid-b", "oid-a")).ShouldBeFalse();

        await using var db = _database.NewContext();
        (await db.Groups.CountAsync(Ct)).ShouldBe(2);
        (await db.GroupMemberships.CountAsync(Ct)).ShouldBe(2);
    }

    [Test]
    public async Task A_changed_set_adds_and_removes_but_keeps_the_group_that_has_no_member_left()
    {
        var ada = NewUser("ada");
        await SeedAsync(ada);
        await SetAsync(ada.Id, "oid-a", "oid-b");

        (await SetAsync(ada.Id, "oid-b", "oid-c")).ShouldBeTrue();

        (await GroupsOfAsync(ada.Id)).Select(g => g.Name).ShouldBe(["oid-b", "oid-c"]);
        await using var db = _database.NewContext();
        // The group stays: an administrator may have renamed it, and rooms may give it a role.
        (await db.Groups.CountAsync(Ct)).ShouldBe(3);
    }

    [Test]
    public async Task An_empty_set_removes_every_linked_membership_and_none_of_the_local_ones()
    {
        var ada = NewUser("ada");
        var local = Group.Create(Guid.CreateVersion7(), "Friends", Now);
        await SeedAsync(ada, local, GroupMembership.Create(local.Id, ada.Id, Now));
        await SetAsync(ada.Id, "oid-a");

        (await SetAsync(ada.Id)).ShouldBeTrue();

        (await GroupsOfAsync(ada.Id)).ShouldBe([("Friends", GroupSource.Local)]);
    }

    [Test]
    public async Task Two_people_share_one_linked_group()
    {
        var ada = NewUser("ada");
        var bea = NewUser("bea");
        await SeedAsync(ada, bea);

        await SetAsync(ada.Id, "oid-a");
        await SetAsync(bea.Id, "oid-a");

        await using var db = _database.NewContext();
        (await db.Groups.CountAsync(Ct)).ShouldBe(1);
        (await db.GroupMemberships.CountAsync(Ct)).ShouldBe(2);
    }

    [Test]
    public async Task A_group_made_by_another_request_in_between_is_used_not_duplicated()
    {
        var ada = NewUser("ada");
        var other = Group.Linked(Guid.CreateVersion7(), "oid-a", "Engineering", Now);
        await SeedAsync(ada, other);

        await SetAsync(ada.Id, "oid-a");

        (await GroupsOfAsync(ada.Id)).ShouldBe([("Engineering", GroupSource.IdentityProvider)]);
    }

    [Test]
    public async Task Two_linked_groups_cannot_have_the_same_external_id_but_local_groups_can_be_many()
    {
        await SeedAsync(Group.Create(Guid.CreateVersion7(), "A", Now), Group.Create(Guid.CreateVersion7(), "B", Now));
        await SeedAsync(Group.Linked(Guid.CreateVersion7(), "oid-a", "A", Now));

        await Should.ThrowAsync<DbUpdateException>(() =>
            SeedAsync(Group.Linked(Guid.CreateVersion7(), "oid-a", "Again", Now)));
    }

    [Test]
    public async Task Find_by_external_ids_returns_only_the_groups_that_exist()
    {
        await SeedAsync(Group.Linked(Guid.CreateVersion7(), "oid-a", "A", Now),
            Group.Linked(Guid.CreateVersion7(), "oid-b", "B", Now),
            Group.Create(Guid.CreateVersion7(), "Local", Now));
        await using var db = _database.NewContext();

        var found = await new GroupRepository(db).FindByExternalIdsAsync(["oid-a", "oid-x"], Ct);

        found.Select(g => g.ExternalId).ShouldBe(["oid-a"]);
    }

    [Test]
    public async Task Search_finds_names_containing_the_text_ignoring_case_by_name_and_up_to_the_limit()
    {
        await SeedAsync(Group.Create(Guid.CreateVersion7(), "Design team", Now),
            Group.Create(Guid.CreateVersion7(), "Brand design", Now),
            Group.Create(Guid.CreateVersion7(), "Engineering", Now),
            Group.Create(Guid.CreateVersion7(), "Desk", Now));
        await using var db = _database.NewContext();
        var groups = new GroupRepository(db);

        (await groups.SearchAsync("DESIGN", 20, Ct)).Select(g => g.Name).ShouldBe(["Brand design", "Design team"]);
        (await groups.SearchAsync("de", 1, Ct)).Count.ShouldBe(1);
        (await groups.SearchAsync("zzz", 20, Ct)).ShouldBeEmpty();
    }

    [Test]
    public async Task Room_roles_are_set_changed_listed_by_group_name_and_removed()
    {
        var ada = NewUser("ada");
        var room = Room.Create(Guid.CreateVersion7(), "R", Now, ada.Id);
        var b = Group.Create(Guid.CreateVersion7(), "Beta", Now);
        var a = Group.Create(Guid.CreateVersion7(), "Alpha", Now);
        await SeedAsync(ada, room, b, a);

        await using (var db = _database.NewContext())
        {
            var groups = new GroupRepository(db);
            await groups.SetRoomRoleAsync(room.Id, b.Id, BoardRole.Viewer, Now, Ct);
            await groups.SetRoomRoleAsync(room.Id, a.Id, BoardRole.Editor, Now, Ct);
            await db.SaveChangesAsync(Ct);
        }

        await using (var db = _database.NewContext())
        {
            var groups = new GroupRepository(db);
            await groups.SetRoomRoleAsync(room.Id, b.Id, BoardRole.Owner, Now, Ct);
            await db.SaveChangesAsync(Ct);
            (await groups.ListForRoomAsync(room.Id, Ct)).Select(g => (g.GroupName, g.Role))
                .ShouldBe([("Alpha", BoardRole.Editor), ("Beta", BoardRole.Owner)]);
            (await groups.RemoveRoomRoleAsync(room.Id, a.Id, Ct)).ShouldBeTrue();
            await db.SaveChangesAsync(Ct);
            (await groups.RemoveRoomRoleAsync(room.Id, a.Id, Ct)).ShouldBeFalse();
            (await groups.ListForRoomAsync(room.Id, Ct)).Select(g => g.GroupName).ShouldBe(["Beta"]);
        }
    }

    [Test]
    public async Task
        Deleting_a_group_removes_its_memberships_and_room_roles_and_deleting_a_room_removes_its_group_roles()
    {
        var ada = NewUser("ada");
        var room = Room.Create(Guid.CreateVersion7(), "R", Now, ada.Id);
        var group = Group.Create(Guid.CreateVersion7(), "G", Now);
        var other = Group.Create(Guid.CreateVersion7(), "H", Now);
        await SeedAsync(ada,
            room,
            group,
            other,
            GroupMembership.Create(group.Id, ada.Id, Now),
            RoomGroupMembership.Create(room.Id, group.Id, BoardRole.Editor, Now),
            RoomGroupMembership.Create(room.Id, other.Id, BoardRole.Viewer, Now));

        await using (var db = _database.NewContext())
        {
            db.Groups.Remove(await db.Groups.SingleAsync(g => g.Id == group.Id, Ct));
            await db.SaveChangesAsync(Ct);
        }

        await using (var db = _database.NewContext())
        {
            (await db.GroupMemberships.CountAsync(Ct)).ShouldBe(0);
            (await db.RoomGroupMemberships.CountAsync(Ct)).ShouldBe(1);
            db.Rooms.Remove(await db.Rooms.SingleAsync(Ct));
            await db.SaveChangesAsync(Ct);
            (await db.RoomGroupMemberships.CountAsync(Ct)).ShouldBe(0);
            (await db.Groups.CountAsync(Ct)).ShouldBe(1);
        }
    }

    [Test]
    public async Task Deleting_a_person_removes_their_group_memberships()
    {
        var ada = NewUser("ada");
        var group = Group.Create(Guid.CreateVersion7(), "G", Now);
        await SeedAsync(ada, group, GroupMembership.Create(group.Id, ada.Id, Now));

        await using var db = _database.NewContext();
        db.Users.Remove(await db.Users.SingleAsync(Ct));
        await db.SaveChangesAsync(Ct);

        (await db.GroupMemberships.CountAsync(Ct)).ShouldBe(0);
    }
}
