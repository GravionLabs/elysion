using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class AdminRepository(ElysionDbContext db) : IAdminRepository
{
    public async Task<PagedResult<AdminUserDto>> ListUsersAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var users = db.Users.AsNoTracking().AsQueryable();
        var needle = Needle(query);
        if (needle is not null)
        {
            // `ToLower()` is translated to `lower(...)`; the overloads CA1862 asks for are not translated by EF Core.
#pragma warning disable CA1862
            users = users.Where(u => u.DisplayName.ToLower().Contains(needle)
                                     || (u.Email != null && u.Email.ToLower().Contains(needle)));
#pragma warning restore CA1862
        }

        var total = await users.CountAsync(cancellationToken);
        var rows = await users.OrderByDescending(u => u.CreatedAt)
            .ThenBy(u => u.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(u => new { u.Id, u.DisplayName, u.Email, u.CreatedAt, u.LastSeenAt, u.DeactivatedAt })
            .ToListAsync(cancellationToken);

        // The groups of this page's people in one query.
        var ids = rows.Select(r => r.Id).ToList();
        var memberships = await db.GroupMemberships.AsNoTracking()
            .Where(m => ids.Contains(m.UserId))
            .Select(m => new { m.UserId, m.GroupId, m.Group!.Name })
            .ToListAsync(cancellationToken);
        var byUser = memberships.GroupBy(m => m.UserId)
            .ToDictionary(g => g.Key,
                g => (IReadOnlyList<AdminGroupRef>)g.OrderBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
                    .Select(m => new AdminGroupRef(m.GroupId, m.Name))
                    .ToList());

        var items = rows.Select(r => new AdminUserDto(r.Id,
                r.DisplayName,
                r.Email,
                r.CreatedAt,
                r.LastSeenAt,
                byUser.GetValueOrDefault(r.Id) ?? [],
                r.DeactivatedAt))
            .ToList();
        return new PagedResult<AdminUserDto>(items, total, page, pageSize);
    }

    public async Task<AdminUserDetailDto?> GetUserAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return null;
        }

        var groups = await db.GroupMemberships.AsNoTracking()
            .Where(m => m.UserId == id)
            .Select(m => new { m.GroupId, m.Group!.Name })
            .ToListAsync(cancellationToken);
        var rooms = await db.RoomMemberships.AsNoTracking()
            .Where(m => m.UserId == id)
            .Select(m => new { m.RoomId, m.Room!.Name, m.Role })
            .ToListAsync(cancellationToken);
        var boards = await db.BoardMemberships.AsNoTracking()
            .Where(m => m.UserId == id)
            .Select(m => new { m.BoardId, m.Board!.Name, m.Role })
            .ToListAsync(cancellationToken);

        // The creator of a board or room is its Owner without a membership row (see BoardRepository.GetRoleAsync): they belong in the list.
        var ownedRooms = await db.Rooms.AsNoTracking()
            .Where(r => r.OwnerId == id)
            .Select(r => new { RoomId = r.Id, r.Name, Role = BoardRole.Owner })
            .ToListAsync(cancellationToken);
        var ownedBoards = await db.Boards.AsNoTracking()
            .Where(b => b.OwnerId == id)
            .Select(b => new { BoardId = b.Id, b.Name, Role = BoardRole.Owner })
            .ToListAsync(cancellationToken);
        rooms = rooms.Where(r => ownedRooms.All(o => o.RoomId != r.RoomId)).Concat(ownedRooms).ToList();
        boards = boards.Where(r => ownedBoards.All(o => o.BoardId != r.BoardId)).Concat(ownedBoards).ToList();

        return new AdminUserDetailDto(user.Id,
            user.DisplayName,
            user.Email,
            user.CreatedAt,
            user.LastSeenAt,
            groups.OrderBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(g => new AdminGroupRef(g.GroupId, g.Name))
                .ToList(),
            rooms.OrderBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(r => new AdminMembershipDto(r.RoomId, r.Name, r.Role.ToString()))
                .ToList(),
            boards.OrderBy(b => b.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(b => new AdminMembershipDto(b.BoardId, b.Name, b.Role.ToString()))
                .ToList(),
            user.DeactivatedAt);
    }

    public async Task<PagedResult<AdminGroupDto>> ListGroupsAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var groups = db.Groups.AsNoTracking().AsQueryable();
        var needle = Needle(query);
        if (needle is not null)
        {
#pragma warning disable CA1862
            groups = groups.Where(g => g.Name.ToLower().Contains(needle)
                                       || (g.ExternalId != null && g.ExternalId.ToLower().Contains(needle)));
#pragma warning restore CA1862
        }

        var total = await groups.CountAsync(cancellationToken);
        var items = await Project(groups.OrderBy(g => g.Name)
                .ThenBy(g => g.CreatedAt)
                .ThenBy(g => g.Id)
                .Skip((page - 1) * pageSize)
                .Take(pageSize))
            .ToListAsync(cancellationToken);
        return new PagedResult<AdminGroupDto>(items, total, page, pageSize);
    }

    public async Task<AdminGroupDto?> GetGroupAsync(Guid id, CancellationToken cancellationToken)
    {
        Guard.Against.Default(id);
        return await Project(db.Groups.AsNoTracking().Where(g => g.Id == id)).FirstOrDefaultAsync(cancellationToken);
    }

    private IQueryable<AdminGroupDto> Project(IQueryable<Entities.Group> groups) =>
        groups.Select(g => new AdminGroupDto(g.Id,
            g.Name,
            g.Source.ToString(),
            g.ExternalId,
            db.GroupMemberships.Count(m => m.GroupId == g.Id),
            db.RoomGroupMemberships.Count(m => m.GroupId == g.Id)));

    public async Task<PagedResult<AdminMemberDto>> ListGroupMembersAsync(Guid groupId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        Guard.Against.Default(groupId);
        var members = db.GroupMemberships.AsNoTracking().Where(m => m.GroupId == groupId);
        var total = await members.CountAsync(cancellationToken);
        var items = await members.OrderBy(m => m.User!.DisplayName)
            .ThenBy(m => m.UserId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(m => new AdminMemberDto(m.UserId, m.User!.DisplayName, m.User.Email, m.User.DeactivatedAt))
            .ToListAsync(cancellationToken);
        return new PagedResult<AdminMemberDto>(items, total, page, pageSize);
    }

    public async Task<PagedResult<AdminRoomDto>> ListRoomsAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var rooms = db.Rooms.AsNoTracking().AsQueryable();
        var needle = Needle(query);
        if (needle is not null)
        {
#pragma warning disable CA1862
            rooms = rooms.Where(r => r.Name.ToLower().Contains(needle));
#pragma warning restore CA1862
        }

        var total = await rooms.CountAsync(cancellationToken);
        var rows = await rooms.OrderByDescending(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => new
            {
                r.Id,
                r.Name,
                r.CreatedAt,
                OwnerId = r.OwnerId,
                OwnerName = r.Owner != null ? r.Owner.DisplayName : null,
                MemberCount = db.RoomMemberships.Count(m => m.RoomId == r.Id),
                GroupCount = db.RoomGroupMemberships.Count(m => m.RoomId == r.Id),
                BoardCount = db.Boards.Count(b => b.RoomId == r.Id),
            })
            .ToListAsync(cancellationToken);
        var items = rows.Select(r => new AdminRoomDto(r.Id,
                r.Name,
                r.OwnerId is { } ownerId && r.OwnerName is not null ? new AdminOwnerDto(ownerId, r.OwnerName) : null,
                r.MemberCount,
                r.GroupCount,
                r.BoardCount,
                r.CreatedAt))
            .ToList();
        return new PagedResult<AdminRoomDto>(items, total, page, pageSize);
    }

    public async Task<AdminStatsDto> GetStatsAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var since = now.AddDays(-30);
        return new AdminStatsDto(
            await db.Users.CountAsync(cancellationToken),
            await db.Users.CountAsync(u => u.LastSeenAt != null && u.LastSeenAt >= since, cancellationToken),
            await db.Groups.CountAsync(cancellationToken),
            await db.Rooms.CountAsync(cancellationToken),
            await db.Boards.CountAsync(cancellationToken));
    }

    public async Task<bool> ExternalIdTakenAsync(string externalId,
        Guid exceptGroupId,
        CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(externalId);
        var id = externalId.Trim();
        return await db.Groups.AsNoTracking()
            .AnyAsync(g => g.ExternalId == id && g.Id != exceptGroupId, cancellationToken);
    }

    private static string? Needle(string? query)
    {
        var text = query?.Trim();
        return string.IsNullOrEmpty(text) ? null : text.ToLowerInvariant();
    }
}
