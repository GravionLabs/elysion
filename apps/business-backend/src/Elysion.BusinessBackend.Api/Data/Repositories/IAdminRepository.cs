using Elysion.BusinessBackend.Api.Contracts;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>
/// The reads of the <c>/admin</c> area (ADR 0027): metadata about people, groups and rooms, with paging. They return names, counts
/// and roles; nothing about what is on a board. Writes go through the entities' own repositories.
/// </summary>
public interface IAdminRepository
{
    Task<PagedResult<AdminUserDto>> ListUsersAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    Task<AdminUserDetailDto?> GetUserAsync(Guid id, CancellationToken cancellationToken);

    Task<PagedResult<AdminGroupDto>> ListGroupsAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    Task<AdminGroupDto?> GetGroupAsync(Guid id, CancellationToken cancellationToken);

    Task<PagedResult<AdminMemberDto>> ListGroupMembersAsync(Guid groupId,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    /// <summary>The people the directory lists in a linked group who have not signed in yet, by address.</summary>
    Task<PagedResult<AdminPendingMemberDto>> ListGroupPendingAsync(Guid groupId,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    Task<AdminGraphStatusDto> GetGraphStatusAsync(bool enabled, TimeSpan interval, CancellationToken cancellationToken);

    Task<PagedResult<AdminRoomDto>> ListRoomsAsync(string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    Task<AdminStatsDto> GetStatsAsync(DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Whether another group has this external id.</summary>
    Task<bool> ExternalIdTakenAsync(string externalId, Guid exceptGroupId, CancellationToken cancellationToken);
}
