using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class UserRepository(ElysionDbContext db) : IUserRepository
{
    public async Task<User?> FindBySubjectForUpdateAsync(string subject, CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(subject);
        return await db.Users.FirstOrDefaultAsync(u => u.Subject == subject, cancellationToken);
    }

    public async Task<User?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<User>> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(email);
        var lowered = email.Trim().ToLowerInvariant();
        // `ToLower()` is translated to `lower(...)` in SQL; the `string.Equals(.., StringComparison)` overloads that CA1862 asks for
        // are not translated by EF Core, so the analyzer's advice does not apply inside a query.
#pragma warning disable CA1862
        return await db.Users.AsNoTracking()
            .Where(u => u.Email != null && u.Email.ToLower() == lowered)
            .ToListAsync(cancellationToken);
#pragma warning restore CA1862
    }

    public async Task<User> GetOrAddAsync(User user, CancellationToken cancellationToken)
    {
        Guard.Against.Null(user);
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return user;
        }
        catch (DbUpdateException)
        {
            // Not every failed insert is the race: only when the subject exists now did somebody else win it.
            db.Entry(user).State = EntityState.Detached;
            var winner = await db.Users.FirstOrDefaultAsync(u => u.Subject == user.Subject, cancellationToken);
            if (winner is null)
            {
                throw;
            }

            return winner;
        }
    }
}
