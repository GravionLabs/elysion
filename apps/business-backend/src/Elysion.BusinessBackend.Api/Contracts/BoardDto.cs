
/// <summary>The caller's role on a board: <c>Owner</c>, <c>Editor</c> or <c>Viewer</c>.</summary>
public sealed record MembershipDto(Guid BoardId, string Role);
