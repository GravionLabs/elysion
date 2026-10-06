using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>
/// Templates. A user sees the built-in ones and their own. <see cref="Add"/> and <see cref="Remove"/> only stage
/// a change, <see cref="IUnitOfWork.SaveChangesAsync"/> commits it.
/// </summary>
public interface ITemplateRepository
{
    /// <summary>The templates a user can see, built-in first, then by name. Without their scenes: those can be large.</summary>
    Task<IReadOnlyList<Template>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>One template with its scene, or null when there is none or the user cannot see it.</summary>
    Task<Template?> FindVisibleAsync(Guid id, Guid userId, CancellationToken cancellationToken);

    void Add(Template template);

    void Remove(Template template);
}
