using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class AuditRepository(ElysionDbContext db) : IAuditRepository
{
    private const int PurgeBatch = 1000;

    public async Task<PagedResult<AuditEntryDto>> QueryAsync(Guid? subjectId,
        Guid? actorId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var entries = db.AuditEntries.AsNoTracking().AsQueryable();
        if (subjectId is { } subject)
        {
            entries = entries.Where(e => e.SubjectId == subject);
        }

        if (actorId is { } actor)
        {
            entries = entries.Where(e => e.ActorUserId == actor);
        }

        if (from is { } start)
        {
            entries = entries.Where(e => e.At >= start);
        }

        if (to is { } end)
        {
            entries = entries.Where(e => e.At < end);
        }

        var total = await entries.CountAsync(cancellationToken);
        var rows = await entries.OrderByDescending(e => e.At)
            .ThenByDescending(e => e.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
        return new(await ToDtosAsync(rows, cancellationToken), total, page, pageSize);
    }

    public async Task<IReadOnlyList<AuditEntryDto>> ListForSubjectAsync(string subjectType,
        Guid subjectId,
        int take,
        CancellationToken cancellationToken)
    {
        var rows = await db.AuditEntries.AsNoTracking()
            .Where(e => e.SubjectType == subjectType && e.SubjectId == subjectId)
            .OrderByDescending(e => e.At)
            .ThenByDescending(e => e.Id)
            .Take(take)
            .ToListAsync(cancellationToken);
        return await ToDtosAsync(rows, cancellationToken);
    }

    public async Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff, CancellationToken cancellationToken)
    {
        var removed = 0;
        while (true)
        {
            // In batches and without ExecuteDelete, which the in-memory provider of the tests does not know.
            var batch = await db.AuditEntries.Where(e => e.At < cutoff)
                .OrderBy(e => e.At)
                .Take(PurgeBatch)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0)
            {
                return removed;
            }

            db.AuditEntries.RemoveRange(batch);
            await db.SaveChangesAsync(cancellationToken);
            removed += batch.Count;
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>Adds the current names of the people, groups, rooms and boards the entries are about: a few queries per page.</summary>
    private async Task<IReadOnlyList<AuditEntryDto>> ToDtosAsync(List<AuditEntry> rows,
        CancellationToken cancellationToken)
    {
        List<Guid> ids(string type) => rows.Where(e => e.SubjectType == type && e.SubjectId != null)
            .Select(e => e.SubjectId!.Value)
            .Distinct()
            .ToList();

        var details = rows.ToDictionary(e => e.Id, e => ParseDetails(e.Details));

        Guid? targetOf(AuditEntry e) =>
            details[e.Id] is { ValueKind: JsonValueKind.Object } d
            && d.TryGetProperty("userId", out var id)
            && id.ValueKind == JsonValueKind.String
            && id.TryGetGuid(out var guid)
                ? guid
                : null;

        var userIds = ids(AuditActions.User)
            .Concat(rows.Where(e => e.ActorUserId != null).Select(e => e.ActorUserId!.Value))
            .Concat(rows.Select(targetOf).Where(id => id != null).Select(id => id!.Value))
            .Distinct()
            .ToList();
        var people = userIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Users.AsNoTracking()
                .Where(u => userIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, u => u.DisplayName, cancellationToken);
        var groupIds = ids(AuditActions.Group);
        var groups = groupIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Groups.AsNoTracking()
                .Where(g => groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id, g => g.Name, cancellationToken);
        var roomIds = ids(AuditActions.Room);
        var rooms = roomIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Rooms.AsNoTracking()
                .Where(r => roomIds.Contains(r.Id))
                .ToDictionaryAsync(r => r.Id, r => r.Name, cancellationToken);
        var boardIds = ids(AuditActions.Board);
        var boards = boardIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Boards.AsNoTracking()
                .Where(b => boardIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.Name, cancellationToken);

        return rows.Select(e => new AuditEntryDto(
                e.Id,
                e.At,
                e.Action,
                e.SubjectType,
                e.SubjectId,
                e.SubjectId is not { } subject
                    ? null
                    : (e.SubjectType switch
                    {
                        AuditActions.User => people,
                        AuditActions.Group => groups,
                        AuditActions.Room => rooms,
                        AuditActions.Board => boards,
                        _ => null
                    })?.GetValueOrDefault(subject),
                e.ActorUserId is { } a && people.TryGetValue(a, out var name) ? new AuditActorDto(a, name) : null,
                targetOf(e) is { } t && people.TryGetValue(t, out var targetName)
                    ? new AuditActorDto(t, targetName)
                    : null,
                details[e.Id],
                e.RequestId))
            .ToList();
    }

    private static JsonElement? ParseDetails(string? details)
    {
        if (string.IsNullOrEmpty(details))
        {
            return null;
        }

        try
        {
            return JsonDocument.Parse(details).RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
