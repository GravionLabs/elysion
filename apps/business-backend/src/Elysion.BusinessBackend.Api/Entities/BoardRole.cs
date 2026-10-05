namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// What a member may do on a board. Stored as its name, not its number, so the database stays readable
/// and reordering the enum cannot silently change what a stored role means.
/// </summary>
public enum BoardRole
{
    /// <summary>Everything, including sharing and deleting the board.</summary>
    Owner,

    /// <summary>Edits the board's content.</summary>
    Editor,

    /// <summary>Sees the board, changes nothing.</summary>
    Viewer,
}
