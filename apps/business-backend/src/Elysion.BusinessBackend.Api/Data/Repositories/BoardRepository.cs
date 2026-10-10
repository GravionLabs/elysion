using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class BoardRepository(ElysionDbContext db) : IBoardRepository
{
    public async Task<IReadOnlyList<Board>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        // Visible: the user's own and shared boards, and the boards of the rooms they are in (ADR 0019).
        return await db.Boards
            .AsNoTracking()
            .Where(board => board.OwnerId == userId
                            || board.Memberships.Any(m => m.UserId == userId)
                            || (board.RoomId != null
                                && db.Rooms.Any(room => room.Id == board.RoomId
                                                        && (room.OwnerId == userId
                                                            || room.Memberships.Any(m => m.UserId == userId)))))
            .OrderByDescending(board => board.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<BoardRole?> GetRoleAsync(Guid boardId, Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(boardId);
        Guard.Against.Default(userId);
        var board = await db.Boards
            .AsNoTracking()
            .Where(b => b.Id == boardId)
            .Select(b => new
            {
                b.OwnerId,
                b.RoomId,
                Role = b.Memberships.Where(m => m.UserId == userId).Select(m => (BoardRole?)m.Role).FirstOrDefault()
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (board is null)
        {
            return null;
        }

        var own = board.OwnerId == userId ? BoardRole.Owner : board.Role;
        if (board.RoomId is not { } roomId)
        {
            return own;
        }

        // The room's role adds to the board's own; the higher one counts. Leaving a room never takes away a role
        // the person was given on the board itself.
        var room = await db.Rooms
            .AsNoTracking()
            .Where(r => r.Id == roomId)
            .Select(r => new
            {
                r.OwnerId,
                Role = r.Memberships.Where(m => m.UserId == userId).Select(m => (BoardRole?)m.Role).FirstOrDefault()
            })
            .FirstOrDefaultAsync(cancellationToken);
        var viaRoom = room is null ? null : room.OwnerId == userId ? BoardRole.Owner : room.Role;
        return Higher(own, viaRoom);
    }

    private static BoardRole? Higher(BoardRole? first, BoardRole? second)
    {
        if (first is null)
        {
            return second;
        }

        return second is { } other && BoardPolicies.Rank(other) > BoardPolicies.Rank(first.Value) ? other : first;
    }

    public async Task<Board?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Boards.AsNoTracking().FirstOrDefaultAsync(board => board.Id == id, cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Boards.AnyAsync(board => board.Id == id, cancellationToken);
    }

    public async Task<Board?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Boards.FirstOrDefaultAsync(board => board.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<Board>> ListInRoomForUpdateAsync(Guid roomId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        return await db.Boards.Where(board => board.RoomId == roomId).ToListAsync(cancellationToken);
    }

    public void Add(Board board) => db.Boards.Add(Guard.Against.Null(board));

    public void Remove(Board board) => db.Boards.Remove(Guard.Against.Null(board));
}
