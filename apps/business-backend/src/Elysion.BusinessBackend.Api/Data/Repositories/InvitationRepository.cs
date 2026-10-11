using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class InvitationRepository(ElysionDbContext db) : IInvitationRepository
{
    public Task<Invitation?> FindByHashForUpdateAsync(string tokenHash, CancellationToken cancellationToken) =>
        db.Invitations.FirstOrDefaultAsync(i => i.TokenHash == tokenHash, cancellationToken);

    public Task<Invitation?> FindForUpdateAsync(Guid? boardId,
        Guid? roomId,
        Guid invitationId,
        CancellationToken cancellationToken) =>
        db.Invitations.FirstOrDefaultAsync(
            i => i.Id == invitationId && i.BoardId == boardId && i.RoomId == roomId,
            cancellationToken);

    public async Task<IReadOnlyList<Invitation>> ListActiveAsync(Guid? boardId,
        Guid? roomId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var rows = await db.Invitations.AsNoTracking()
            .Where(i => i.BoardId == boardId && i.RoomId == roomId && i.RevokedAt == null)
            .ToListAsync(cancellationToken);
        // Filtered and ordered in memory: a provider without DateTimeOffset comparison (SQLite in the tests) would refuse it,
        // and a target has at most a few dozen links.
        return rows.Where(i => i.IsActive(now)).OrderBy(i => i.CreatedAt).ThenBy(i => i.Id).ToList();
    }

    public void Add(Invitation invitation) => db.Invitations.Add(invitation);
}
