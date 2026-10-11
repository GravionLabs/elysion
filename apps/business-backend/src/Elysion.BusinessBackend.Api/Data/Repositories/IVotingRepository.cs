using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>The dot votings of a board (#732). Changes are staged; <see cref="IUnitOfWork.SaveChangesAsync"/> commits them.</summary>
public interface IVotingRepository
{
    /// <summary>The open voting of a board, else the one closed last, with its votes and their voters; null when there is none.</summary>
    Task<VotingSession?> GetCurrentAsync(Guid boardId, CancellationToken cancellationToken);

    /// <summary>A voting of the board by id, tracked, with its votes and their voters; null when the board has no such voting.</summary>
    Task<VotingSession?> FindAsync(Guid boardId, Guid votingId, CancellationToken cancellationToken);

    Task<bool> HasOpenAsync(Guid boardId, CancellationToken cancellationToken);

    void Add(VotingSession session);

    void AddVote(Vote vote);

    void RemoveVote(Vote vote);

    /// <summary>Stages the removal of every closed voting of the board with its votes.</summary>
    Task ClearClosedAsync(Guid boardId, CancellationToken cancellationToken);
}
