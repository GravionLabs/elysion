using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Invitations;

public enum AcceptOutcome
{
    Joined,
    AlreadyEnough,
    Unknown,
    Gone,
}

public sealed record AcceptResult(
    AcceptOutcome Outcome,
    string Kind = "",
    Guid TargetId = default,
    BoardRole Role = default);

/// <summary>
/// Following an invitation link (#734). A use is counted only when the link added a membership or raised one: someone who
/// has the link's role or a higher one already (also through a room, or as the creator) is told their role and nothing
/// changes, so a link is not used up by people who did not need it. The person's own membership row is the one that is
/// added or raised; the creator and the room's role are not touched.
/// </summary>
public sealed class InvitationService(
    IInvitationRepository invitations,
    IBoardRepository boards,
    IRoomRepository rooms,
    IMembershipRepository boardMemberships,
    IRoomMembershipRepository roomMemberships,
    IUnitOfWork unitOfWork,
    TimeProvider time)
{
    private const int Attempts = 3;

    public async Task<AcceptResult> AcceptAsync(string token, Guid userId, CancellationToken cancellationToken)
    {
        if (!InvitationTokens.LooksValid(token))
        {
            return new(AcceptOutcome.Unknown);
        }

        var hash = InvitationTokens.Hash(token);
        for (var attempt = 1;; attempt++)
        {
            try
            {
                return await TryAcceptAsync(hash, userId, cancellationToken);
            }
            catch (DbUpdateConcurrencyException) when (attempt < Attempts)
            {
                // Somebody else used the link at the same moment: look at it again (it may be used up now).
                unitOfWork.DiscardChanges();
            }
        }
    }

    private async Task<AcceptResult> TryAcceptAsync(string hash, Guid userId, CancellationToken cancellationToken)
    {
        var invitation = await invitations.FindByHashForUpdateAsync(hash, cancellationToken);
        if (invitation is null)
        {
            return new(AcceptOutcome.Unknown);
        }

        if (!invitation.IsActive(time.GetUtcNow()))
        {
            return new(AcceptOutcome.Gone);
        }

        var isBoard = invitation.BoardId is not null;
        var targetId = (invitation.BoardId ?? invitation.RoomId)!.Value;
        var current = isBoard
            ? await boards.GetRoleAsync(targetId, userId, cancellationToken)
            : await rooms.GetRoleAsync(targetId, userId, cancellationToken);
        var kind = isBoard ? "board" : "room";
        if (current is { } have && BoardPolicies.Rank(have) >= BoardPolicies.Rank(invitation.Role))
        {
            return new(AcceptOutcome.AlreadyEnough, kind, targetId, have);
        }

        var now = time.GetUtcNow();
        if (isBoard)
        {
            var own = await boardMemberships.FindForUpdateAsync(targetId, userId, cancellationToken);
            if (own is null)
            {
                boardMemberships.Add(BoardMembership.Create(targetId, userId, invitation.Role, now));
            }
            else
            {
                own.Role = invitation.Role;
            }
        }
        else
        {
            var own = await roomMemberships.FindForUpdateAsync(targetId, userId, cancellationToken);
            if (own is null)
            {
                roomMemberships.Add(RoomMembership.Create(targetId, userId, invitation.Role, now));
            }
            else
            {
                own.Role = invitation.Role;
            }
        }

        invitation.Uses++;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new(AcceptOutcome.Joined, kind, targetId, invitation.Role);
    }
}
