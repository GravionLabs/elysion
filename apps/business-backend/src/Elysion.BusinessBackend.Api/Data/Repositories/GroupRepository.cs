using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class GroupRepository(ElysionDbContext db) : IGroupRepository
{
    public async Task<Group?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == id, cancellationToken);
    }

    public async Task<Group?> FindForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await db.Groups.FirstOrDefaultAsync(g => g.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<Group>> SearchAsync(string query, int limit, CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(query);
        Guard.Against.NegativeOrZero(limit);
        var needle = query.Trim().ToLowerInvariant();
        // `ToLower()` is translated to `lower(...)`; the overloads CA1862 asks for are not translated by EF Core.
#pragma warning disable CA1862
        return await db.Groups.AsNoTracking()
            .Where(g => g.Name.ToLower().Contains(needle))
            .OrderBy(g => g.Name)
            .ThenBy(g => g.CreatedAt)
            .Take(limit)
            .ToListAsync(cancellationToken);
#pragma warning restore CA1862
    }

    public async Task<IReadOnlyList<Group>> GetForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        return await db.GroupMemberships.AsNoTracking()
            .Where(m => m.UserId == userId)
            .Select(m => m.Group!)
            .OrderBy(g => g.Name)
            .ThenBy(g => g.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Group>> FindByExternalIdsAsync(IReadOnlyCollection<string> externalIds,
        CancellationToken cancellationToken)
    {
        Guard.Against.Null(externalIds);
        if (externalIds.Count == 0)
        {
            return [];
        }

        return await db.Groups.AsNoTracking()
            .Where(g => g.ExternalId != null && externalIds.Contains(g.ExternalId))
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> SetLinkedMembershipsAsync(Guid userId,
        IReadOnlyCollection<string> externalIds,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        Guard.Against.Null(externalIds);
        var wanted = externalIds.ToHashSet(StringComparer.Ordinal);

        if (!await StageLinkedMembershipsAsync(userId, wanted, now, cancellationToken))
        {
            return false;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another request created the same group (or this membership) first: look again, once, with what is there now.
            db.ChangeTracker.Clear();
            if (await StageLinkedMembershipsAsync(userId, wanted, now, cancellationToken))
            {
                await db.SaveChangesAsync(cancellationToken);
            }
        }

        return true;
    }

    /// <summary>Stages the difference between the person's linked memberships and <paramref name="wanted"/>; false when there is none.</summary>
    private async Task<bool> StageLinkedMembershipsAsync(Guid userId,
        HashSet<string> wanted,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // What the person has now in linked groups: one query, with the external id of each.
        var current = await db.GroupMemberships
            .Where(m => m.UserId == userId && m.Group!.Source == GroupSource.IdentityProvider)
            .Select(m => new { Membership = m, m.Group!.ExternalId })
            .ToListAsync(cancellationToken);

        var changed = false;
        foreach (var gone in current.Where(c => c.ExternalId is null || !wanted.Contains(c.ExternalId)))
        {
            db.GroupMemberships.Remove(gone.Membership);
            changed = true;
        }

        var have = current.Where(c => c.ExternalId is not null)
            .Select(c => c.ExternalId!)
            .ToHashSet(StringComparer.Ordinal);
        var missing = wanted.Where(id => !have.Contains(id)).ToList();
        if (missing.Count == 0)
        {
            return changed;
        }

        var known = await db.Groups
            .Where(g => g.ExternalId != null && missing.Contains(g.ExternalId))
            .ToDictionaryAsync(g => g.ExternalId!, StringComparer.Ordinal, cancellationToken);
        foreach (var externalId in missing)
        {
            if (!known.TryGetValue(externalId, out var group))
            {
                group = Group.Linked(Guid.CreateVersion7(), externalId, externalId, now);
                db.Groups.Add(group);
            }

            db.GroupMemberships.Add(GroupMembership.Create(group.Id, userId, now));
        }

        return true;
    }

    public async Task<bool> AddMemberAsync(Guid groupId,
        Guid userId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(groupId);
        Guard.Against.Default(userId);
        if (await db.GroupMemberships.AnyAsync(m => m.GroupId == groupId && m.UserId == userId, cancellationToken))
        {
            return false;
        }

        db.GroupMemberships.Add(GroupMembership.Create(groupId, userId, now));
        return true;
    }

    public async Task<bool> RemoveMemberAsync(Guid groupId, Guid userId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(groupId);
        Guard.Against.Default(userId);
        var existing = await db.GroupMemberships.FindAsync([groupId, userId], cancellationToken);
        if (existing is null)
        {
            return false;
        }

        db.GroupMemberships.Remove(existing);
        return true;
    }

    public void Add(Group group) => db.Groups.Add(Guard.Against.Null(group));

    public void Remove(Group group) => db.Groups.Remove(Guard.Against.Null(group));

    public async Task<IReadOnlyList<RoomGroupRole>> ListForRoomAsync(Guid roomId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        var rows = await db.RoomGroupMemberships.AsNoTracking()
            .Where(m => m.RoomId == roomId)
            .Select(m => new { m.GroupId, m.Group!.Name, m.Role, m.CreatedAt })
            .ToListAsync(cancellationToken);
        return rows.OrderBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(r => r.CreatedAt)
            .Select(r => new RoomGroupRole(r.GroupId, r.Name, r.Role))
            .ToList();
    }

    public async Task SetRoomRoleAsync(Guid roomId,
        Guid groupId,
        BoardRole role,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        Guard.Against.Default(groupId);
        var existing = await db.RoomGroupMemberships.FindAsync([roomId, groupId], cancellationToken);
        if (existing is null)
        {
            db.RoomGroupMemberships.Add(RoomGroupMembership.Create(roomId, groupId, role, now));
        }
        else
        {
            existing.Role = role;
        }
    }

    public async Task<bool> RemoveRoomRoleAsync(Guid roomId, Guid groupId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(roomId);
        Guard.Against.Default(groupId);
        var existing = await db.RoomGroupMemberships.FindAsync([roomId, groupId], cancellationToken);
        if (existing is null)
        {
            return false;
        }

        db.RoomGroupMemberships.Remove(existing);
        return true;
    }
}
