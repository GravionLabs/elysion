using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class GroupSyncRepository(ElysionDbContext db) : IGroupSyncRepository
{
    public async Task<IReadOnlyList<Group>> ListLinkedAsync(CancellationToken cancellationToken)
    {
        var linked = await db.Groups.AsNoTracking()
            .Where(g => g.Source == GroupSource.IdentityProvider && g.ExternalId != null)
            .OrderBy(g => g.CreatedAt)
            .ToListAsync(cancellationToken);
        return linked.Where(g => Guid.TryParse(g.ExternalId, out _)).ToList();
    }

    public async Task<GroupSyncResult> ApplyAsync(Guid groupId,
        string? directoryName,
        IReadOnlyCollection<GraphMember> members,
        DateTimeOffset now,
        Action<GroupSyncResult>? onChange,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(groupId);
        Guard.Against.Null(members);
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Id == groupId, cancellationToken);
        if (group is null || group.Source != GroupSource.IdentityProvider)
        {
            return new GroupSyncResult(false, 0, 0, 0, 0);
        }

        var renamed = directoryName is not null && group.NameFromDirectory(directoryName);

        // The people of the directory by address; a person without an address cannot be matched to anybody and is skipped.
        var wanted = new Dictionary<string, GraphMember>(StringComparer.Ordinal);
        foreach (var member in members)
        {
            if (member.Email is { } email)
            {
                wanted.TryAdd(email.ToLowerInvariant(), member);
            }
        }

        var emails = wanted.Keys.ToList();
        var known = new Dictionary<string, User>(StringComparer.Ordinal);
        if (emails.Count > 0)
        {
            // Chunks keep the IN list small for the database.
            foreach (var chunk in emails.Chunk(500))
            {
                var found = await db.Users
                    .Where(u => u.Email != null && chunk.Contains(u.Email.ToLower()))
                    .ToListAsync(cancellationToken);
                foreach (var user in found)
                {
                    known.TryAdd(user.Email!.ToLowerInvariant(), user);
                }
            }
        }

        // Real memberships: add what is missing for known, active people; take away the sync's own that the directory dropped.
        var current = await db.GroupMemberships.Include(m => m.User)
            .Where(m => m.GroupId == groupId)
            .ToListAsync(cancellationToken);
        var currentByUser = current.ToDictionary(m => m.UserId);
        var added = 0;
        var removed = 0;
        foreach (var (email, user) in known)
        {
            if (user.IsDeactivated || currentByUser.ContainsKey(user.Id))
            {
                continue;
            }

            db.GroupMemberships.Add(new GroupMembership
            {
                GroupId = groupId, UserId = user.Id, CreatedAt = now, FromGraph = true
            });
            added++;
        }

        var listedIds = known.Values.Select(u => u.Id).ToHashSet();
        foreach (var membership in current.Where(m => m.FromGraph && !listedIds.Contains(m.UserId)))
        {
            db.GroupMemberships.Remove(membership);
            removed++;
        }

        // Pending: the people who are listed and not known yet (or deactivated ones are left out of both).
        var pendingWanted = wanted.Where(w => !known.ContainsKey(w.Key)).ToDictionary(w => w.Key, w => w.Value);
        var pending = await db.PendingGroupMemberships.Where(p => p.GroupId == groupId).ToListAsync(cancellationToken);
        var pendingAdded = 0;
        var pendingRemoved = 0;
        foreach (var gone in pending.Where(p => !pendingWanted.ContainsKey(p.Email)))
        {
            db.PendingGroupMemberships.Remove(gone);
            pendingRemoved++;
        }

        var have = pending.Select(p => p.Email).ToHashSet(StringComparer.Ordinal);
        foreach (var (email, member) in pendingWanted.Where(w => !have.Contains(w.Key)))
        {
            if (email.Length > User.MaxEmailLength)
            {
                continue;
            }

            db.PendingGroupMemberships.Add(PendingGroupMembership.Create(groupId,
                email,
                member.DisplayName,
                member.Id,
                now));
            pendingAdded++;
        }

        group.GraphSyncedAt = now;
        var result = new GroupSyncResult(renamed, added, removed, pendingAdded, pendingRemoved);
        if (result.Changed)
        {
            onChange?.Invoke(result);
        }

        await db.SaveChangesAsync(cancellationToken);
        return result;
    }

    public async Task<int> AdoptPendingAsync(Guid userId,
        string email,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(userId);
        if (string.IsNullOrWhiteSpace(email))
        {
            return 0;
        }

        var key = email.Trim().ToLowerInvariant();
        var pending = await db.PendingGroupMemberships
            .Where(p => p.Email == key && p.Group!.Source == GroupSource.IdentityProvider)
            .ToListAsync(cancellationToken);
        if (pending.Count == 0)
        {
            return 0;
        }

        var already = await db.GroupMemberships.Where(m => m.UserId == userId)
            .Select(m => m.GroupId)
            .ToListAsync(cancellationToken);
        var made = 0;
        foreach (var entry in pending)
        {
            if (!already.Contains(entry.GroupId))
            {
                db.GroupMemberships.Add(new GroupMembership
                {
                    GroupId = entry.GroupId, UserId = userId, CreatedAt = now, FromGraph = true
                });
                made++;
            }

            db.PendingGroupMemberships.Remove(entry);
        }

        await db.SaveChangesAsync(cancellationToken);
        return made;
    }

    public async Task ClearPendingAsync(Guid groupId, CancellationToken cancellationToken)
    {
        Guard.Against.Default(groupId);
        var pending = await db.PendingGroupMemberships.Where(p => p.GroupId == groupId).ToListAsync(cancellationToken);
        db.PendingGroupMemberships.RemoveRange(pending);
    }
}
