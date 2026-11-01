using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Webhooks;

namespace Elysion.BusinessBackend.Api.Members;

/// <summary>A member of a board as the API shows them; <c>IsDeactivated</c> marks a person an administrator deactivated (#668): they stay in the list.</summary>
public sealed record MemberView(
    Guid UserId,
    string DisplayName,
    string? Email,
    BoardRole Role,
    bool IsDeactivated = false);

public enum MemberOutcome
{
    Done,

    /// <summary>No user has this email: the person has to log in to Elysion once before they can be added.</summary>
    UnknownEmail,

    /// <summary>No user has this id (a people search result that is gone, or a made-up id).</summary>
    UnknownUser,

    /// <summary>More than one user has this email, so the invitation would be a guess.</summary>
    AmbiguousEmail,

    /// <summary>That user is a member already (change their role instead).</summary>
    AlreadyMember,

    /// <summary>The user has no role on this board.</summary>
    NotAMember,

    /// <summary>The board's creator is its owner for good; the role of the creator cannot be changed or taken away.</summary>
    CreatorStaysOwner,

    /// <summary>The change would leave the board without an Owner.</summary>
    LastOwner,
}

public sealed record MemberResult(MemberOutcome Outcome, MemberView? Member = null)
{
    public bool Succeeded => Outcome == MemberOutcome.Done;
}

/// <summary>
/// Who may open a board and as what: listing, adding by email, changing a role, removing. The caller has been
/// authorized to administer the board; this service keeps the rules of the member list itself.
/// </summary>
/// <remarks>
/// The board's creator (<see cref="Board.OwnerId"/>) is an Owner whatever their membership row says (see
/// <c>IBoardRepository.GetRoleAsync</c>), so they cannot be demoted or removed: the change would have no effect, and
/// pretending it had would be worse. Other Owners can be, but never the last one.
/// </remarks>
public sealed class BoardMemberService(
    IBoardRepository boards,
    IMembershipRepository memberships,
    IUserRepository users,
    IAuditLog audit,
    IWebhookEvents webhooks,
    IUnitOfWork unitOfWork,
    TimeProvider time)
{
    public async Task<IReadOnlyList<MemberView>> ListAsync(Guid boardId, CancellationToken cancellationToken)
    {
        var rows = await memberships.ListForBoardAsync(boardId, cancellationToken);
        var members = rows.Select(m => View(m.User!, m.Role)).ToList();

        // The creator is an Owner even without a membership row: show them too.
        var creatorId = (await boards.FindAsync(boardId, cancellationToken))?.OwnerId;
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

    public async Task<MemberResult> AddAsync(Guid boardId,
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
        return await AddUserAsync(boardId, found[0], role, cancellationToken);
    }

    /// <summary>Adds the person the people search returned (<c>GET /users</c>), by id.</summary>
    public async Task<MemberResult> AddByUserIdAsync(Guid boardId,
        Guid userId,
        BoardRole role,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        Guard.Against.EnumOutOfRange(role);
        var user = await users.FindAsync(userId, cancellationToken);
        // A deactivated person is not offered by the people search either: an id of one is as good as unknown (#668).
        return user is null || user.IsDeactivated
            ? new(MemberOutcome.UnknownUser)
            : await AddUserAsync(boardId, user, role, cancellationToken);
    }

    private async Task<MemberResult> AddUserAsync(Guid boardId,
        User user,
        BoardRole role,
        CancellationToken cancellationToken)
    {
        var board = await boards.FindAsync(boardId, cancellationToken);
        if (board?.OwnerId == user.Id
            || await memberships.FindForUpdateAsync(boardId, user.Id, cancellationToken) is not null)
        {
            return new(MemberOutcome.AlreadyMember);
        }

        memberships.Add(BoardMembership.Create(boardId, user.Id, role, time.GetUtcNow()));
        audit.Record(AuditActions.MemberAdded,
            AuditActions.Board,
            boardId,
            new { userId = user.Id, role = role.ToString() });
        await webhooks.RaiseAsync(WebhookEventTypes.MemberAdded,
            boardId,
            new { userId = user.Id, role = role.ToString() },
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new(MemberOutcome.Done, View(user, role));
    }

    public async Task<MemberResult> ChangeRoleAsync(Guid boardId,
        Guid userId,
        BoardRole role,
        CancellationToken cancellationToken)
    {
        Guard.Against.EnumOutOfRange(role);
        var blocked = await CheckAsync(boardId, userId, newRole: role, cancellationToken);
        if (blocked is not null)
            return blocked;

        var membership = (await memberships.FindForUpdateAsync(boardId, userId, cancellationToken))!;
        var before = membership.Role;
        membership.Role = role;
        audit.Record(AuditActions.MemberRoleChanged,
            AuditActions.Board,
            boardId,
            new { userId, from = before.ToString(), to = role.ToString() });
        if (before != role)
        {
            await webhooks.RaiseAsync(WebhookEventTypes.MemberRoleChanged,
                boardId,
                new { userId, previousRole = before.ToString(), role = role.ToString() },
                cancellationToken);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        var user = (await users.FindAsync(userId, cancellationToken))!;
        return new(MemberOutcome.Done, View(user, role));
    }

    public async Task<MemberResult> RemoveAsync(Guid boardId, Guid userId, CancellationToken cancellationToken)
    {
        var blocked = await CheckAsync(boardId, userId, newRole: null, cancellationToken);
        if (blocked is not null)
            return blocked;

        var membership = (await memberships.FindForUpdateAsync(boardId, userId, cancellationToken))!;
        memberships.Remove(membership);
        audit.Record(AuditActions.MemberRemoved,
            AuditActions.Board,
            boardId,
            new { userId, role = membership.Role.ToString() });
        await webhooks.RaiseAsync(WebhookEventTypes.MemberRemoved,
            boardId,
            new { userId, role = membership.Role.ToString() },
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new(MemberOutcome.Done);
    }

    /// <summary>Why a change to <paramref name="userId"/> is refused, or null when it may go ahead.</summary>
    private async Task<MemberResult?> CheckAsync(Guid boardId,
        Guid userId,
        BoardRole? newRole,
        CancellationToken cancellationToken)
    {
        var board = await boards.FindAsync(boardId, cancellationToken);
        if (board?.OwnerId == userId)
            return new(MemberOutcome.CreatorStaysOwner);

        var all = await memberships.ListForBoardAsync(boardId, cancellationToken);
        var target = all.FirstOrDefault(m => m.UserId == userId);
        if (target is null)
            return new(MemberOutcome.NotAMember);

        var losesOwnership = target.Role == BoardRole.Owner && newRole != BoardRole.Owner;
        if (losesOwnership)
        {
            var owners = all.Where(m => m.Role == BoardRole.Owner).Select(m => m.UserId).ToHashSet();
            if (board?.OwnerId is { } creator)
                owners.Add(creator);
            owners.Remove(userId);
            if (owners.Count == 0)
                return new(MemberOutcome.LastOwner);
        }

        return null;
    }

    private static MemberView View(User user, BoardRole role) =>
        new(user.Id, user.DisplayName, user.Email, role, user.IsDeactivated);
}
