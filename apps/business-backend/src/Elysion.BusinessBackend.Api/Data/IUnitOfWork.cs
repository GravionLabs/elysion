namespace Elysion.BusinessBackend.Api.Data;

/// <summary>
/// Commits what the repositories staged, in one transaction. A request that changes more than one aggregate
/// (duplicating a board adds a board and a document) stages with each repository and commits once here.
/// </summary>
public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
