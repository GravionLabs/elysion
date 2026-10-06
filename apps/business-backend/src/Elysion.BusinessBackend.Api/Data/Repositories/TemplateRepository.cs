using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class TemplateRepository(ElysionDbContext db) : ITemplateRepository
{
    public async Task<IReadOnlyList<Template>> ListVisibleToAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        return await db.Templates
            .AsNoTracking()
            .Where(t => t.IsBuiltIn || t.OwnerId == userId)
            .OrderByDescending(t => t.IsBuiltIn)
            .ThenBy(t => t.Name)
            .Select(t => new Template
            {
                Id = t.Id,
                Name = t.Name,
                Description = t.Description,
                Scene = string.Empty, // not loaded
                IsBuiltIn = t.IsBuiltIn,
                CreatedAt = t.CreatedAt,
                OwnerId = t.OwnerId,
            })
            .ToListAsync(cancellationToken);
    }

    public Task<Template?> FindVisibleAsync(Guid id, Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        // Tracked: Remove after it needs the entity the context knows.
        return db.Templates.FirstOrDefaultAsync(t => t.Id == id && (t.IsBuiltIn || t.OwnerId == userId),
            cancellationToken);
    }

    public void Add(Template template) => db.Templates.Add(template);

    public void Remove(Template template) => db.Templates.Remove(template);
}
