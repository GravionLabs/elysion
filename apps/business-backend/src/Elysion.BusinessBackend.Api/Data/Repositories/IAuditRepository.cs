using Elysion.BusinessBackend.Api.Contracts;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>Reads of the audit log (#669). Writing goes through <c>IAuditLog</c>, which stages entries on the unit of work.</summary>
public interface IAuditRepository
{
    /// <summary>The log of the instance, newest first, filtered by what it is about, who did it and when.</summary>
    Task<PagedResult<AuditEntryDto>> QueryAsync(Guid? subjectId,
        Guid? actorId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    /// <summary>The latest entries about one board or room (<c>board</c> or <c>room</c>), newest first.</summary>
    Task<IReadOnlyList<AuditEntryDto>> ListForSubjectAsync(string subjectType,
        Guid subjectId,
        int take,
        CancellationToken cancellationToken);

    /// <summary>Removes the entries older than <paramref name="cutoff"/> (a batch at a time); returns how many.</summary>
    Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff, CancellationToken cancellationToken);
}
