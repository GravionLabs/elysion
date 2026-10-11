using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>
/// The personal side of a board (#730): when the person last opened it and whether they starred it. <see cref="RecordVisit"/> and
/// <see cref="SetFavorite"/> stage a change, <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.
/// </summary>
public interface IBoardUserStateRepository
{
    /// <summary>The state of the given boards for a user; a board the user never opened and did not star is not in the answer.</summary>
    Task<IReadOnlyDictionary<Guid, BoardUserState>> StatesAsync(
        Guid userId,
        IReadOnlyCollection<Guid> boardIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// Notes that the user opened the board at <paramref name="now"/>, unless they did within <paramref name="minInterval"/> already
    /// (then nothing is staged). Whether a change was staged.
    /// </summary>
    Task<bool> RecordVisitAsync(
        Guid boardId,
        Guid userId,
        DateTimeOffset now,
        TimeSpan minInterval,
        CancellationToken cancellationToken);

    /// <summary>Stars or unstars a board for a user; doing it twice is the same as once.</summary>
    Task SetFavoriteAsync(Guid boardId,
        Guid userId,
        bool favorite,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}
