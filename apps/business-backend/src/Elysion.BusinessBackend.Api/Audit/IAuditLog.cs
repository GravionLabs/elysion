namespace Elysion.BusinessBackend.Api.Audit;

/// <summary>
/// Writes the audit log (#669). <see cref="Record"/> only <b>stages</b> the entry on the request's unit of work, so it is saved in
/// the same transaction as the change it is about: no entry without the change, no change without the entry.
/// </summary>
public interface IAuditLog
{
    /// <param name="action">One of <see cref="AuditActions"/>.</param>
    /// <param name="subjectType"><see cref="AuditActions.Board"/>, <see cref="AuditActions.Room"/>, <see cref="AuditActions.Group"/> or <see cref="AuditActions.User"/>.</param>
    /// <param name="subjectId">What it happened to.</param>
    /// <param name="details">A small object that is written as JSON: ids, roles, counts, group names. Never a token, an email address or content.</param>
    /// <param name="actorUserId">Who did it; the caller of the request when null, and nobody when the request has no user.</param>
    void Record(string action, string subjectType, Guid? subjectId, object? details = null, Guid? actorUserId = null);
}
