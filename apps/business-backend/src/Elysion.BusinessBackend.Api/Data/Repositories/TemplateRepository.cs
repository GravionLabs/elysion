using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class TemplateRepository(ElysionDbContext db) : ITemplateRepository
{
    public async Task<IReadOnlyList<Template>> ListAsync(CancellationToken cancellationToken) =>
        await db.Templates
            .AsNoTracking()
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
            })
            .ToListAsync(cancellationToken);

    public Task<Template?> FindAsync(Guid id, CancellationToken cancellationToken) =>
        db.Templates.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
}
