using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Members;

public enum LifecycleOutcome
{
    Done,

    /// <summary>There is no such person.</summary>
    UnknownUser,

    /// <summary>An administrator cannot deactivate themselves: nobody would be left to undo it.</summary>
    Self,

    /// <summary>A hand-over is for a deactivated person: the one who gives has to be deactivated first.</summary>
    GiverStillActive,

    /// <summary>The one who takes over is deactivated, or is the one who gives.</summary>
    InvalidReceiver,
}

public sealed record LifecycleResult(LifecycleOutcome Outcome, int Boards = 0, int Rooms = 0)
{
    public bool Succeeded => Outcome == LifecycleOutcome.Done;
}

/// <summary>
/// Deactivating and reactivating a person and handing over what they own (#668, ADR 0027). Only Elysion's own state changes: the
/// identity provider is not told (Elysion has no administrator access to it), so the account has to be disabled there as well.
/// Every change is written to the audit log in the same transaction. The administrator who does it gets no role from it: the new
/// owner is the one who gets one.
/// </summary>
public sealed class UserLifecycleService(
    IUserRepository users,
    IOwnershipRepository ownership,
    IAuditLog audit,
    IUnitOfWork unitOfWork,
    TimeProvider time)
{
    /// <summary>Deactivates the person; one who is deactivated already stays as they are (and writes nothing).</summary>
    public async Task<LifecycleResult> DeactivateAsync(Guid userId, Guid actorId, CancellationToken cancellationToken)
    {
        if (userId == actorId)
        {
            return new(LifecycleOutcome.Self);
        }

        var user = await users.FindForUpdateAsync(userId, cancellationToken);
        if (user is null)
        {
            return new(LifecycleOutcome.UnknownUser);
        }

        if (!user.IsDeactivated)
        {
            user.DeactivatedAt = time.GetUtcNow();
            audit.Record(AuditActions.UserDeactivated, AuditActions.User, userId);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return new(LifecycleOutcome.Done);
    }

    public async Task<LifecycleResult> ReactivateAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.FindForUpdateAsync(userId, cancellationToken);
        if (user is null)
        {
            return new(LifecycleOutcome.UnknownUser);
        }

        if (user.IsDeactivated)
        {
            user.DeactivatedAt = null;
            audit.Record(AuditActions.UserReactivated, AuditActions.User, userId);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return new(LifecycleOutcome.Done);
    }

    /// <summary>
    /// Makes <paramref name="toUserId"/> the Owner of every board and room that <paramref name="fromUserId"/> owned (as creator or by
    /// an Owner membership); the previous owner keeps no role on them. All or nothing, in one transaction; one audit entry per board and room.
    /// </summary>
    public async Task<LifecycleResult> TransferAsync(Guid fromUserId,
        Guid toUserId,
        CancellationToken cancellationToken)
    {
        var from = await users.FindForUpdateAsync(fromUserId, cancellationToken);
        var to = await users.FindForUpdateAsync(toUserId, cancellationToken);
        if (from is null || to is null)
        {
            return new(LifecycleOutcome.UnknownUser);
        }

        if (!from.IsDeactivated)
        {
            return new(LifecycleOutcome.GiverStillActive);
        }

        if (to.IsDeactivated || to.Id == from.Id)
        {
            return new(LifecycleOutcome.InvalidReceiver);
        }

        var now = time.GetUtcNow();
        var boards = await ownership.BoardsOwnedByAsync(from.Id, cancellationToken);
        foreach (var board in boards)
        {
            var wasCreator = board.OwnerId == from.Id;
            if (wasCreator)
            {
                board.OwnerId = to.Id;
            }

            foreach (var membership in board.Memberships.Where(m => m.UserId == from.Id).ToList())
            {
                board.Memberships.Remove(membership);
            }

            var existing = board.Memberships.FirstOrDefault(m => m.UserId == to.Id);
            if (existing is not null)
            {
                existing.Role = BoardRole.Owner;
            }
            else if (board.OwnerId != to.Id)
            {
                board.Memberships.Add(BoardMembership.Create(board.Id, to.Id, BoardRole.Owner, now));
            }

            audit.Record(AuditActions.OwnerTransferred,
                AuditActions.Board,
                board.Id,
                new { fromUserId = from.Id, toUserId = to.Id });
        }

        var rooms = await ownership.RoomsOwnedByAsync(from.Id, cancellationToken);
        foreach (var room in rooms)
        {
            if (room.OwnerId == from.Id)
            {
                room.OwnerId = to.Id;
            }

            foreach (var membership in room.Memberships.Where(m => m.UserId == from.Id).ToList())
            {
                room.Memberships.Remove(membership);
            }

            var existing = room.Memberships.FirstOrDefault(m => m.UserId == to.Id);
            if (existing is not null)
            {
                existing.Role = BoardRole.Owner;
            }
            else if (room.OwnerId != to.Id)
            {
                room.Memberships.Add(RoomMembership.Create(room.Id, to.Id, BoardRole.Owner, now));
            }

            audit.Record(AuditActions.OwnerTransferred,
                AuditActions.Room,
                room.Id,
                new { fromUserId = from.Id, toUserId = to.Id });
        }

        if (boards.Count + rooms.Count > 0)
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return new(LifecycleOutcome.Done, boards.Count, rooms.Count);
    }
}
