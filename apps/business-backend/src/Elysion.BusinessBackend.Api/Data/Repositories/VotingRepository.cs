using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class VotingRepository(ElysionDbContext db) : IVotingRepository
{
    private IQueryable<VotingSession> WithVotes => db.VotingSessions.Include(s => s.Votes).ThenInclude(v => v.User);

    public async Task<VotingSession?> GetCurrentAsync(Guid boardId, CancellationToken cancellationToken)
    {
        var open = await WithVotes.AsNoTracking()
            .FirstOrDefaultAsync(s => s.BoardId == boardId && s.Status == VotingStatus.Open, cancellationToken);
        if (open is not null)
        {
            return open;
        }

        var closed = await WithVotes.AsNoTracking()
            .Where(s => s.BoardId == boardId && s.Status == VotingStatus.Closed)
            .ToListAsync(cancellationToken);
        // Ordered in memory: a provider without DateTimeOffset ordering (SQLite in the tests) would refuse it.
        return closed.OrderByDescending(s => s.ClosedAt ?? s.StartedAt).ThenByDescending(s => s.Id).FirstOrDefault();
    }

    public Task<VotingSession?> FindAsync(Guid boardId, Guid votingId, CancellationToken cancellationToken) =>
        WithVotes.FirstOrDefaultAsync(s => s.BoardId == boardId && s.Id == votingId, cancellationToken);

    public Task<bool> HasOpenAsync(Guid boardId, CancellationToken cancellationToken) =>
        db.VotingSessions.AnyAsync(s => s.BoardId == boardId && s.Status == VotingStatus.Open, cancellationToken);

    public void Add(VotingSession session) => db.VotingSessions.Add(session);

    public void AddVote(Vote vote) => db.Votes.Add(vote);

    public void RemoveVote(Vote vote) => db.Votes.Remove(vote);

    public async Task ClearClosedAsync(Guid boardId, CancellationToken cancellationToken)
    {
        var closed = await db.VotingSessions
            .Where(s => s.BoardId == boardId && s.Status == VotingStatus.Closed)
            .ToListAsync(cancellationToken);
        db.VotingSessions.RemoveRange(closed);
    }
}
