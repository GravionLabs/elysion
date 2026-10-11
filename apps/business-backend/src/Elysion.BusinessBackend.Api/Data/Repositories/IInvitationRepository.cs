using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>The invitation links of boards and rooms. <see cref="Add"/> stages; the unit of work commits.</summary>
public interface IInvitationRepository
{
    /// <summary>The invitation with this token hash, or null; tracked, so a change is saved by the next commit.</summary>
    Task<Invitation?> FindByHashForUpdateAsync(string tokenHash, CancellationToken cancellationToken);

    /// <summary>One invitation of a board (<paramref name="boardId"/>) or of a room, or null; tracked.</summary>
    Task<Invitation?> FindForUpdateAsync(Guid? boardId,
        Guid? roomId,
        Guid invitationId,
        CancellationToken cancellationToken);

    /// <summary>The links of a board or a room that still work at <paramref name="now"/>, oldest first; untracked.</summary>
    Task<IReadOnlyList<Invitation>> ListActiveAsync(Guid? boardId,
        Guid? roomId,
        DateTimeOffset now,
        CancellationToken cancellationToken);

    void Add(Invitation invitation);
}
