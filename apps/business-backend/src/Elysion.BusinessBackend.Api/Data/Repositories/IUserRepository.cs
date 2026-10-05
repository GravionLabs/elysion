using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public interface IUserRepository
{
    /// <summary>The user of an identity-provider subject, or null; tracked, so a change is saved by the next commit.</summary>
    Task<User?> FindBySubjectForUpdateAsync(string subject, CancellationToken cancellationToken);

    /// <summary>A user by id, or null; an untracked copy.</summary>
    Task<User?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// The users with this email, compared without regard to case (an email is how somebody is invited): normally
    /// zero or one; untracked copies.
    /// </summary>
    Task<IReadOnlyList<User>> FindByEmailAsync(string email, CancellationToken cancellationToken);

    /// <summary>
    /// The stored user for <paramref name="user"/>'s subject: <paramref name="user"/> itself after it was
    /// inserted, or the user another request inserted first. Commits at once. Two first requests of the same
    /// person race on the unique index of <c>Subject</c>; the loser gets the winner's row, never a second one
    /// and never an error.
    /// </summary>
    Task<User> GetOrAddAsync(User user, CancellationToken cancellationToken);
}
