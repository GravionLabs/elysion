using System.Text.Json;

using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Logging;

namespace Elysion.BusinessBackend.Api.Audit;

public sealed class AuditLog(
    ElysionDbContext db,
    ICurrentUser currentUser,
    IHttpContextAccessor http,
    TimeProvider time) : IAuditLog
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public void Record(string action,
        string subjectType,
        Guid? subjectId,
        object? details = null,
        Guid? actorUserId = null)
    {
        var text = details is null ? null : JsonSerializer.Serialize(details, Json);
        if (text is { Length: > AuditEntry.MaxDetailsLength })
        {
            // Cut at a structure boundary rather than store a broken object.
            text = "{\"truncated\":true}";
        }

        db.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.CreateVersion7(),
            At = time.GetUtcNow(),
            ActorUserId = actorUserId ?? Actor(),
            Action = action,
            SubjectType = subjectType,
            SubjectId = subjectId,
            Details = text,
            RequestId = RequestId()
        });
    }

    private Guid? Actor()
    {
        try
        {
            return currentUser.Id;
        }
        catch (InvalidOperationException)
        {
            return null; // no user in this request (a background job)
        }
    }

    private string? RequestId()
    {
        var value = http.HttpContext?.Response.Headers[RequestIdMiddleware.HeaderName].ToString();
        return RequestIdMiddleware.IsValid(value) ? value : null;
    }
}
