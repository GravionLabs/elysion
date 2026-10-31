namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>One page of a list of the <c>/admin</c> area: the items, how many there are in all, and which page this is.</summary>
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public sealed record AdminGroupRef(Guid Id, string Name);

/// <summary>A person in the user list. The groups are the ones the person is in now.</summary>
public sealed record AdminUserDto(
    Guid Id,
    string DisplayName,
    string? Email,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    IReadOnlyList<AdminGroupRef> Groups,
    DateTimeOffset? DeactivatedAt = null,
    bool IsIntegration = false);

/// <summary>A room or board a person has a direct role in (<c>Role</c> is Owner, Editor or Viewer): names and roles, no content.</summary>
public sealed record AdminMembershipDto(Guid Id, string Name, string Role);

public sealed record AdminUserDetailDto(
    Guid Id,
    string DisplayName,
    string? Email,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    IReadOnlyList<AdminGroupRef> Groups,
    IReadOnlyList<AdminMembershipDto> Rooms,
    IReadOnlyList<AdminMembershipDto> Boards,
    DateTimeOffset? DeactivatedAt = null,
    bool IsIntegration = false);

/// <summary><c>Source</c> is Local or IdentityProvider (linked); <c>ExternalId</c> is the claim value of a linked group.</summary>
public sealed record AdminGroupDto(
    Guid Id,
    string Name,
    string Source,
    string? ExternalId,
    int MemberCount,
    int RoomCount,
    int PendingCount = 0,
    DateTimeOffset? LastSyncAt = null);

/// <summary>A person the directory lists in a linked group who has not signed in yet (#667).</summary>
public sealed record AdminPendingMemberDto(string Email, string? DisplayName);

/// <summary>Whether the Graph sync runs, its interval, when it last read a group and how many people wait for their first sign-in (#667).</summary>
public sealed record AdminGraphStatusDto(
    bool Enabled,
    int IntervalMinutes,
    DateTimeOffset? LastSyncAt,
    int PendingMembers);

public sealed record AdminMemberDto(Guid Id, string DisplayName, string? Email, DateTimeOffset? DeactivatedAt = null);

public sealed record AdminOwnerDto(Guid Id, string DisplayName);

/// <summary>A room by its metadata. No board names and no content.</summary>
public sealed record AdminRoomDto(
    Guid Id,
    string Name,
    AdminOwnerDto? Owner,
    int MemberCount,
    int GroupCount,
    int BoardCount,
    DateTimeOffset CreatedAt);

public sealed record AdminStatsDto(int Users, int UsersSeenLast30Days, int Groups, int Rooms, int Boards);

/// <summary>Body of <c>POST /admin/groups</c>.</summary>
public sealed record AdminGroupCreateRequest(string? Name);

/// <summary>Body of <c>POST /admin/boards/transfer</c> (#668): the person who left and the person who takes over what they owned.</summary>
public sealed record AdminTransferRequest(Guid FromUserId, Guid ToUserId);

/// <summary>How many boards and rooms changed owner.</summary>
public sealed record AdminTransferResultDto(int Boards, int Rooms);

/// <summary>
/// A personal access token in the administration (#851): whose it is and what it may do, never the secret or its hash. <c>Prefix</c>
/// is the start of the secret, so a leaked token can be found.
/// </summary>
public sealed record AdminAccessTokenDto(
    Guid Id,
    string Name,
    string Prefix,
    IReadOnlyList<string> Scopes,
    AdminOwnerDto Owner,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RevokedAt);
