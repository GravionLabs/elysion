using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Groups;

public class GroupEntityTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);

    [Test]
    public void A_local_group_has_a_trimmed_name_no_external_id_and_the_local_source()
    {
        var group = Group.Create(Guid.CreateVersion7(), "  Design  ", Now);

        (group.Name, group.ExternalId, group.Source).ShouldBe(("Design", null, GroupSource.Local));
    }

    [TestCase("")]
    [TestCase("   ")]
    public void A_local_group_needs_a_name(string name) =>
        Should.Throw<ArgumentException>(() => Group.Create(Guid.CreateVersion7(), name, Now));

    [Test]
    public void A_local_group_name_is_at_most_120_characters()
    {
        Group.Create(Guid.CreateVersion7(), new string('x', Group.MaxNameLength), Now);

        Should.Throw<ArgumentException>(() => Group.Create(Guid.CreateVersion7(), new string('x', 121), Now));
    }

    [Test]
    public void A_group_needs_an_id() =>
        Should.Throw<ArgumentException>(() => Group.Create(Guid.Empty, "Design", Now));

    [Test]
    public void A_linked_group_keeps_its_external_id_and_has_the_provider_as_source()
    {
        var group = Group.Linked(Guid.CreateVersion7(), " 5f3a-oid ", "5f3a-oid", Now);

        (group.ExternalId, group.Name, group.Source).ShouldBe(("5f3a-oid", "5f3a-oid", GroupSource.IdentityProvider));
    }

    [Test]
    public void A_linked_group_named_after_a_long_id_gets_the_name_cut_to_fit()
    {
        var id = new string('a', Group.MaxExternalIdLength);

        var group = Group.Linked(Guid.CreateVersion7(), id, id, Now);

        group.Name.Length.ShouldBe(Group.MaxNameLength);
        group.ExternalId.ShouldBe(id);
    }

    [TestCase("")]
    [TestCase("  ")]
    public void A_linked_group_needs_an_external_id(string externalId) =>
        Should.Throw<ArgumentException>(() => Group.Linked(Guid.CreateVersion7(), externalId, "Name", Now));

    [Test]
    public void An_external_id_over_255_characters_is_refused() =>
        Should.Throw<ArgumentException>(() =>
            Group.Linked(Guid.CreateVersion7(), new string('a', 256), "Name", Now));

    [Test]
    public void A_membership_needs_a_group_and_a_person()
    {
        GroupMembership.Create(Guid.CreateVersion7(), Guid.CreateVersion7(), Now);

        Should.Throw<ArgumentException>(() => GroupMembership.Create(Guid.Empty, Guid.CreateVersion7(), Now));
        Should.Throw<ArgumentException>(() => GroupMembership.Create(Guid.CreateVersion7(), Guid.Empty, Now));
    }

    [Test]
    public void A_room_role_of_a_group_needs_a_room_a_group_and_a_defined_role()
    {
        RoomGroupMembership.Create(Guid.CreateVersion7(), Guid.CreateVersion7(), BoardRole.Editor, Now);

        Should.Throw<ArgumentException>(() =>
            RoomGroupMembership.Create(Guid.Empty, Guid.CreateVersion7(), BoardRole.Editor, Now));
        Should.Throw<ArgumentException>(() =>
            RoomGroupMembership.Create(Guid.CreateVersion7(), Guid.Empty, BoardRole.Editor, Now));
        Should.Throw<ArgumentException>(() =>
            RoomGroupMembership.Create(Guid.CreateVersion7(), Guid.CreateVersion7(), (BoardRole)99, Now));
    }
}
