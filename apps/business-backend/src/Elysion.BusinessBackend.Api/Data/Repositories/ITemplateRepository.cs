using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public interface ITemplateRepository
{
    /// <summary>All templates, built-in first, then by name. Without their scenes: those can be large.</summary>
    Task<IReadOnlyList<Template>> ListAsync(CancellationToken cancellationToken);

    /// <summary>One template with its scene, or null.</summary>
    Task<Template?> FindAsync(Guid id, CancellationToken cancellationToken);
}
