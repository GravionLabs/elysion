namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// The Yjs state of a board's canvas, one full snapshot per board (ADR 0011). Kept apart from
/// <see cref="Board"/> so listing boards never reads the blob. The key is the id as the realtime
/// service knows it, a string: there is deliberately no foreign key, because ids such as
/// <c>default</c> have no <see cref="Board"/> row.
/// </summary>
public class BoardDocument
{
    public const int MaxBoardIdLength = 200;

    public required string BoardId { get; set; }
    public required byte[] State { get; set; }

    /// <summary>Counts the saves; a writer has to name the version its state is based on.</summary>
    public long Version { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
