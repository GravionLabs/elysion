using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Members;

/// <summary>
/// Who is in a room and as what: listing, adding by email, changing a role, removing. The same rules as for the
/// members of a board (<see cref="BoardMemberService"/>), with the same results: the room's creator is an Owner for
/// good, and a room always keeps at least one Owner. The caller has been authorized to administer the room.
/// </summary>
public sealed class RoomMemberService(
    IRoomRepository rooms,
    IRoomMembershipRepository memberships,
    IUserRepository users,
    IUnitOfWork unitOfWork,
    TimeProvider time)
{
    public async Task<IReadOnlyList<MemberView>> ListAsync(Guid roomId, CancellationToken cancellationToken)
    {
        var rows = await memberships.ListForRoomAsync(roomId, cancellationToken);
        var members = rows.Select(m => View(m.User!, m.Role)).ToList();

        // The creator is an Owner even without a membership row: show them too.
        var creatorId = (await rooms.FindAsync(roomId, cancellationToken))?.OwnerId;
        if (creatorId is { } id)
        {
            var creator = await users.FindAsync(id, cancellationToken);
            if (creator is not null)
            {
                members.RemoveAll(m => m.UserId == id);
                members.Insert(0, View(creator, BoardRole.Owner));
            }
        }

        return members;
    }

    public async Task<MemberResult> AddAsync(Guid roomId,
        string email,
        BoardRole role,
        CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(email);
        Guard.Against.EnumOutOfRange(role);
        var found = await users.FindByEmailAsync(email, cancellationToken);
        if (found.Count == 0)
            return new(MemberOutcome.UnknownEmail);
        if (found.Count > 1)
            return new(MemberOutcome.AmbiguousEmail);
        var user = found[0];

        var room = await rooms.FindAsync(roomId, cancellationToken);
        if (room?.OwnerId == user.Id
            || await memberships.FindForUpdateAsync(roomId, user.Id, cancellationToken) is not null)
        {
            return new(MemberOutcome.AlreadyMember);
        }

        memberships.Add(RoomMembership.Create(roomId, user.Id, role, time.GetUtcNow()));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new(MemberOutcome.Done, View(user, role));
    }

    public async Task<MemberResult> ChangeRoleAsync(Guid roomId,
        Guid userId,
        BoardRole role,
        CancellationToken cancellationToken)
    {
        Guard.Against.EnumOutOfRange(role);
        var blocked = await CheckAsync(roomId, userId, newRole: role, cancellationToken);
        if (blocked is not null)
            return blocked;

        var membership = (await memberships.FindForUpdateAsync(roomId, userId, cancellationToken))!;
        membership.Role = role;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var user = (await users.FindAsync(userId, cancellationToken))!;
        return new(MemberOutcome.Done, View(user, role));
    }

    public async Task<MemberResult> RemoveAsync(Guid roomId, Guid userId, CancellationToken cancellationToken)
    {
        var blocked = await CheckAsync(roomId, userId, newRole: null, cancellationToken);
        if (blocked is not null)
            return blocked;

        memberships.Remove((await memberships.FindForUpdateAsync(roomId, userId, cancellationToken))!);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new(MemberOutcome.Done);
    }

    /// <summary>Why a change to <paramref name="userId"/> is refused, or null when it may go ahead.</summary>
    private async Task<MemberResult?> CheckAsync(Guid roomId,
        Guid userId,
        BoardRole? newRole,
        CancellationToken cancellationToken)
    {
        var room = await rooms.FindAsync(roomId, cancellationToken);
        if (room?.OwnerId == userId)
            return new(MemberOutcome.CreatorStaysOwner);

        var all = await memberships.ListForRoomAsync(roomId, cancellationToken);
        var target = all.FirstOrDefault(m => m.UserId == userId);
        if (target is null)
            return new(MemberOutcome.NotAMember);

        var losesOwnership = target.Role == BoardRole.Owner && newRole != BoardRole.Owner;
        if (losesOwnership)
        {
            var owners = all.Where(m => m.Role == BoardRole.Owner).Select(m => m.UserId).ToHashSet();
            if (room?.OwnerId is { } creator)
                owners.Add(creator);
            owners.Remove(userId);
            if (owners.Count == 0)
                return new(MemberOutcome.LastOwner);
        }

        return null;
    }

    private static MemberView View(User user, BoardRole role) => new(user.Id, user.DisplayName, user.Email, role);
}
