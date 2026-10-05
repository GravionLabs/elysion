using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>
/// Boards. Reads return detached copies unless the name says otherwise; <see cref="Add"/> and
/// <see cref="Remove"/> only stage a change, <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.
/// </summary>
public interface IBoardRepository
{
    /// <summary>All boards, the most recently created first.</summary>
    Task<IReadOnlyList<Board>> ListNewestFirstAsync(CancellationToken cancellationToken);

    /// <summary>One board, or null. A copy that is not tracked: changes to it are not saved.</summary>
    Task<Board?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>One board, or null, tracked: a change to it is saved by the next commit.</summary>
    Task<Board?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken);

    void Add(Board board);

    void Remove(Board board);
}
