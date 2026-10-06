namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>The caller's role on a board: <c>Owner</c>, <c>Editor</c> or <c>Viewer</c>.</summary>
public sealed record MembershipDto(Guid BoardId, string Role);

/// <summary>A member of a board: who, how they are shown, and their role (<c>Owner</c>, <c>Editor</c>, <c>Viewer</c>).</summary>
public sealed record MemberDto(Guid UserId, string DisplayName, string? Email, string Role);

/// <summary>Body for adding a member: the email of a user who has logged in at least once, and the role to give.</summary>
public sealed record AddMemberRequest(string? Email, string? Role);

/// <summary>Body for changing a member's role.</summary>
public sealed record ChangeRoleRequest(string? Role);
