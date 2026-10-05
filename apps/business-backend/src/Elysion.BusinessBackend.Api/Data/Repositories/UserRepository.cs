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
