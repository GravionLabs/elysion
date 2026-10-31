namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>How a snapshot came about (ADR 0032).</summary>
public enum SnapshotKind
{
    /// <summary>Saved by a person with "Save version"; kept until somebody deletes it.</summary>
    Manual,

    /// <summary>Made by the backend when the realtime service saved; expires.</summary>
    Auto,

    /// <summary>Made before a restore (#847); expires like an automatic one.</summary>
    BeforeRestore,
}

/// <summary>
/// A version of a board (ADR 0032): the row is the metadata, the gzipped Yjs state is in the object store under
/// <c>snapshots/{boardId}/{id}.yjs.gz</c>. It goes with its board.
/// </summary>
public class BoardSnapshot
{
    public const int MaxNameLength = 120;

    public Guid Id { get; set; }
    public Guid BoardId { get; set; }

    /// <summary>Null for an automatic snapshot and for a manual one saved without a name.</summary>
    public string? Name { get; set; }

    public SnapshotKind Kind { get; set; }

    /// <summary>The subject of the person who saved it; null for an automatic snapshot.</summary>
    public string? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Size of the gzipped state.</summary>
    public long SizeBytes { get; set; }

    /// <summary>Live elements in the snapshot, when the realtime service told (<c>X-Elysion-Element-Count</c>).</summary>
    public int? ElementCount { get; set; }

    public Board? Board { get; set; }

    /// <summary>Trims the name; null when nothing is left, false when it is too long.</summary>
    public static bool TryNormalizeName(string? name, out string? normalized)
    {
        normalized = string.IsNullOrWhiteSpace(name) ? null : name.Trim();
        return normalized is null || normalized.Length <= MaxNameLength;
    }
}
