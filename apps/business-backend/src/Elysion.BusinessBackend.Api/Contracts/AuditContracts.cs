using System.Text.Json;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A person named in an audit entry (the name is the one they have now).</summary>
public sealed record AuditActorDto(Guid Id, string DisplayName);

/// <summary>
/// One line of the audit log (#669). <c>SubjectName</c> is the current name of the group, room, board or person (null when it is
/// gone), <c>Target</c> the person the entry is about when the change was made to a person (<c>details.userId</c>), <c>Details</c> a
/// small object with ids, roles and counts, <c>RequestId</c> the id of the log lines of the request.
/// </summary>
public sealed record AuditEntryDto(
    Guid Id,
    DateTimeOffset At,
    string Action,
    string SubjectType,
    Guid? SubjectId,
    string? SubjectName,
    AuditActorDto? Actor,
    AuditActorDto? Target,
    JsonElement? Details,
    string? RequestId);
