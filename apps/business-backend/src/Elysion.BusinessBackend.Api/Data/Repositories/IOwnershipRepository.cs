using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>What a person owns, loaded to be handed over (#668). The entities are tracked: the unit of work saves what the service changes.</summary>
public interface IOwnershipRepository
{
    /// <summary>The boards the person created or holds an Owner membership on, with their memberships.</summary>
    Task<IReadOnlyList<Board>> BoardsOwnedByAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>The rooms the person created or holds an Owner membership in, with their memberships.</summary>
    Task<IReadOnlyList<Room>> RoomsOwnedByAsync(Guid userId, CancellationToken cancellationToken);
}
