using Elysion.BusinessBackend.Api.Entities;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The guard clauses of the entity factories: code-to-code invariants, not HTTP validation.</summary>
public class FactoryGuardTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static Guid Id() => Guid.CreateVersion7();

    public class BoardCreate
    {
        [Test]
        public void Makes_a_board_and_trims_the_name()
        {
            var id = Id();
            var board = Board.Create(id, "  Retro  ", Now);

            board.Id.ShouldBe(id);
            board.Name.ShouldBe("Retro");
            board.CreatedAt.ShouldBe(Now);
            board.OwnerId.ShouldBeNull();
        }

        [Test]
        public void Accepts_the_longest_name_and_an_owner()
        {
            var owner = Id();

            var board = Board.Create(Id(), new string('x', Board.MaxNameLength), Now, owner);

            board.Name.Length.ShouldBe(Board.MaxNameLength);
            board.OwnerId.ShouldBe(owner);
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase("   ")]
        public void Refuses_a_missing_or_blank_name(string? name) =>
            Should.Throw<ArgumentException>(() => Board.Create(Id(), name!, Now));

        [Test]
        public void Refuses_a_name_over_the_limit() =>
            Should.Throw<ArgumentException>(() => Board.Create(Id(), new string('x', Board.MaxNameLength + 1), Now));

        [Test]
        public void Refuses_an_empty_id_or_owner()
        {
            Should.Throw<ArgumentException>(() => Board.Create(Guid.Empty, "Retro", Now));
            Should.Throw<ArgumentException>(() => Board.Create(Id(), "Retro", Now, Guid.Empty));
        }

        [TestCase("  Retro ", true, "Retro")]
        [TestCase("", false, "")]
        [TestCase(null, false, "")]
        public void TryNormalizeName_is_the_one_rule_for_requests(string? raw, bool valid, string expected)
        {
            Board.TryNormalizeName(raw, out var name).ShouldBe(valid);
            name.ShouldBe(expected);
        }
    }

    public class UserCreate
    {
        [Test]
        public void Makes_a_user_with_trimmed_name_and_email()
        {
            var user = User.Create(Id(), "kc-1", "  Ada Lovelace ", " ada@example.com ", Now);

            user.Subject.ShouldBe("kc-1");
            user.DisplayName.ShouldBe("Ada Lovelace");
            user.Email.ShouldBe("ada@example.com");
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase("  ")]
        public void Has_no_email_when_there_is_none(string? email) =>
            User.Create(Id(), "kc-1", "Ada", email, Now).Email.ShouldBeNull();

        [TestCase(null)]
        [TestCase("")]
        [TestCase("  ")]
        public void Refuses_a_blank_subject_or_display_name(string? text)
        {
            Should.Throw<ArgumentException>(() => User.Create(Id(), text!, "Ada", null, Now));
            Should.Throw<ArgumentException>(() => User.Create(Id(), "kc-1", text!, null, Now));
        }

        [Test]
        public void Refuses_values_longer_than_the_model_allows()
        {
            Should.Throw<ArgumentException>(() =>
                User.Create(Id(), new string('s', User.MaxSubjectLength + 1), "Ada", null, Now));
            Should.Throw<ArgumentException>(() =>
                User.Create(Id(), "kc-1", new string('n', User.MaxDisplayNameLength + 1), null, Now));
            Should.Throw<ArgumentException>(() =>
                User.Create(Id(), "kc-1", "Ada", new string('e', User.MaxEmailLength + 1), Now));
        }

        [Test]
        public void Accepts_values_exactly_at_the_limits() =>
            Should.NotThrow(() => User.Create(
                Id(),
                new string('s', User.MaxSubjectLength),
                new string('n', User.MaxDisplayNameLength),
                new string('e', User.MaxEmailLength),
                Now));

        [Test]
        public void Refuses_an_empty_id() =>
            Should.Throw<ArgumentException>(() => User.Create(Guid.Empty, "kc-1", "Ada", null, Now));
    }

    public class MembershipCreate
    {
        [Test]
        public void Makes_a_membership()
        {
            var board = Id();
            var user = Id();

            var membership = BoardMembership.Create(board, user, BoardRole.Editor, Now);

            (membership.BoardId, membership.UserId, membership.Role).ShouldBe((board, user, BoardRole.Editor));
        }

        [Test]
        public void Refuses_empty_ids()
        {
            Should.Throw<ArgumentException>(() => BoardMembership.Create(Guid.Empty, Id(), BoardRole.Owner, Now));
            Should.Throw<ArgumentException>(() => BoardMembership.Create(Id(), Guid.Empty, BoardRole.Owner, Now));
        }

        [Test]
        public void Refuses_a_role_that_is_not_defined() =>
            Should.Throw<ArgumentException>(() => BoardMembership.Create(Id(), Id(), (BoardRole)42, Now));
    }

    public class RoomCreate
    {
        [Test]
        public void Makes_a_room_and_trims_the_name()
        {
            var id = Id();
            var owner = Id();

            var room = Room.Create(id, "  Sprint planning  ", Now, owner);

            (room.Id, room.Name, room.CreatedAt, room.OwnerId).ShouldBe((id, "Sprint planning", Now, owner));
        }

        [Test]
        public void Accepts_the_longest_name() =>
            Room.Create(Id(), new string('x', Room.MaxNameLength), Now, Id()).Name.Length.ShouldBe(Room.MaxNameLength);

        [TestCase(null)]
        [TestCase("")]
        [TestCase("   ")]
        public void Refuses_a_missing_or_blank_name(string? name) =>
            Should.Throw<ArgumentException>(() => Room.Create(Id(), name!, Now, Id()));

        [Test]
        public void Refuses_a_name_over_the_limit() =>
            Should.Throw<ArgumentException>(() =>
                Room.Create(Id(), new string('x', Room.MaxNameLength + 1), Now, Id()));

        [Test]
        public void Refuses_an_empty_id_or_owner()
        {
            Should.Throw<ArgumentException>(() => Room.Create(Guid.Empty, "Sprint", Now, Id()));
            Should.Throw<ArgumentException>(() => Room.Create(Id(), "Sprint", Now, Guid.Empty));
        }

        [TestCase("  Sprint ", true, "Sprint")]
        [TestCase("", false, "")]
        [TestCase(null, false, "")]
        public void TryNormalizeName_is_the_one_rule_for_requests(string? raw, bool valid, string expected)
        {
            Room.TryNormalizeName(raw, out var name).ShouldBe(valid);
            name.ShouldBe(expected);
        }
    }

    public class RoomMembershipCreate
    {
        [Test]
        public void Makes_a_membership()
        {
            var room = Id();
            var user = Id();

            var membership = RoomMembership.Create(room, user, BoardRole.Editor, Now);

            (membership.RoomId, membership.UserId, membership.Role).ShouldBe((room, user, BoardRole.Editor));
        }

        [Test]
        public void Refuses_empty_ids()
        {
            Should.Throw<ArgumentException>(() => RoomMembership.Create(Guid.Empty, Id(), BoardRole.Owner, Now));
            Should.Throw<ArgumentException>(() => RoomMembership.Create(Id(), Guid.Empty, BoardRole.Owner, Now));
        }

        [Test]
        public void Refuses_a_role_that_is_not_defined() =>
            Should.Throw<ArgumentException>(() => RoomMembership.Create(Id(), Id(), (BoardRole)42, Now));
    }
}
