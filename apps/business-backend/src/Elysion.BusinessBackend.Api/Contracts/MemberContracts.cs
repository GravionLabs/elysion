namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>The caller's role on a board: <c>Owner</c>, <c>Editor</c> or <c>Viewer</c>.</summary>
public sealed record MembershipDto(Guid BoardId, string Role);

/// <summary>
/// A member of a board: who, how they are shown, and their role (<c>Owner</c>, <c>Editor</c>, <c>Viewer</c>). A person an administrator
/// deactivated (#668) stays in the list with <c>IsDeactivated</c>.
/// </summary>
public sealed record MemberDto(Guid UserId, string DisplayName, string? Email, string Role, bool IsDeactivated = false);

/// <summary>
/// Body for adding a member: who (the email of a user who has logged in at least once, or the <c>UserId</c> that the people search
/// returned; exactly one of them) and the role to give.
/// </summary>
public sealed record AddMemberRequest(string? Email, string? Role, Guid? UserId = null);

/// <summary>A person found by <c>GET /users?query=</c>: enough to recognise them and to add them as a member.</summary>
public sealed record UserDto(Guid Id, string DisplayName, string? Email, bool IsIntegration = false);

/// <summary>Body for changing a member's role.</summary>
public sealed record ChangeRoleRequest(string? Role);
