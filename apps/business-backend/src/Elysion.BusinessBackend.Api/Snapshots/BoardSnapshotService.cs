using System.IO.Compression;

using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Files;

namespace Elysion.BusinessBackend.Api.Snapshots;

/// <summary>What <see cref="BoardSnapshotService.CreateManualAsync"/> did.</summary>
public enum SnapshotCreateStatus
{
    Created,

    /// <summary>The board has no stored document yet, so there is nothing to keep.</summary>
    NothingSaved,

    /// <summary>The board has <see cref="BoardSnapshotService.MaxManualPerBoard"/> named versions already.</summary>
    LimitReached,
}

public readonly record struct SnapshotCreateResult(SnapshotCreateStatus Status, SnapshotListing? Snapshot);

/// <summary>
/// Makes and removes snapshots (ADR 0032). The bytes always come from the stored <see cref="BoardDocument"/>, gzipped into the
/// object store; the object is written first and the row second, so a row never lacks its object after a crash (an object
/// without a row is removed by <see cref="SnapshotCleanupService"/>).
/// </summary>
public sealed partial class BoardSnapshotService(
    IBoardSnapshotRepository snapshots,
    IBoardDocumentRepository documents,
    IFileStore store,
    IRealtimeBoardSaver realtime,
    IUnitOfWork unitOfWork,
    TimeProvider time,
    ILogger<BoardSnapshotService> logger)
{
    public const string BeforeRestoreName = "Before restore";
    public const int MaxManualPerBoard = 100;
    public const int MaxAutomaticPerBoard = 50;
    public static readonly TimeSpan AutomaticRetention = TimeSpan.FromDays(30);

    /// <summary>A save makes an automatic snapshot when the newest one is older than this.</summary>
    public static readonly TimeSpan AutomaticInterval = TimeSpan.FromHours(1);

    /// <summary>"Save version": asks the realtime service to store the open board first (best effort), then copies the stored state.</summary>
    public async Task<SnapshotCreateResult> CreateManualAsync(
        Guid boardId,
        string? name,
        string subject,
        CancellationToken cancellationToken)
    {
        if (await snapshots.CountAsync(boardId, true, cancellationToken) >= MaxManualPerBoard)
        {
            return new(SnapshotCreateStatus.LimitReached, null);
        }

        await realtime.SaveNowAsync(boardId, cancellationToken);
        var document = await documents.FindAsync(boardId.ToString(), cancellationToken);
        if (document is null)
        {
            return new(SnapshotCreateStatus.NothingSaved, null);
        }

        var snapshot = await StoreAsync(boardId,
            document.State,
            SnapshotKind.Manual,
            name,
            subject,
            null,
            cancellationToken);
        return new(SnapshotCreateStatus.Created, new SnapshotListing(snapshot, null));
    }

    /// <summary>
    /// Keeps <paramref name="state"/> (the state that is about to be overwritten) as an automatic snapshot, then drops the
    /// automatic ones beyond the cap.
    /// </summary>
    public async Task<BoardSnapshot> CreateAutomaticAsync(
        Guid boardId,
        byte[] state,
        SnapshotKind kind,
        int? elementCount,
        CancellationToken cancellationToken)
    {
        var snapshot = await StoreAsync(boardId,
            state,
            kind,
            kind == SnapshotKind.BeforeRestore ? BeforeRestoreName : null,
            null,
            elementCount,
            cancellationToken);
        var surplus = await snapshots.AutomaticBeyondAsync(boardId, MaxAutomaticPerBoard, cancellationToken);
        await RemoveAsync(surplus, cancellationToken);
        return snapshot;
    }

    /// <summary>
    /// Before a restore (ADR 0032, #847): asks the realtime service to store the open board, then keeps the stored state as
    /// "Before restore", so the restore can always be undone by restoring that one. Null <c>Before</c> when the board has no
    /// stored state (after a successful save that means it is empty). When the save did not succeed (failed, or no realtime
    /// service configured) the stored state may lag the live board, so nothing is kept and <c>Saved</c> is false: the caller
    /// must not restore.
    /// </summary>
    public async Task<(bool Saved, BoardSnapshot? Before)> CreateBeforeRestoreAsync(Guid boardId,
        CancellationToken cancellationToken)
    {
        if (await realtime.SaveNowAsync(boardId, cancellationToken) != RealtimeSaveResult.Saved)
        {
            return (false, null);
        }

        var document = await documents.FindAsync(boardId.ToString(), cancellationToken);
        return (true, document is null
            ? null
            : await CreateAutomaticAsync(boardId, document.State, SnapshotKind.BeforeRestore, null, cancellationToken));
    }

    /// <summary>
    /// <see cref="CreateAutomaticAsync"/> for a save of the realtime service: a failure (the object store is down) is logged and
    /// swallowed, because the save of the board matters more than its history.
    /// </summary>
    public async Task TryCreateAutomaticAsync(Guid boardId,
        byte[] state,
        int? elementCount,
        CancellationToken cancellationToken)
    {
        try
        {
            await CreateAutomaticAsync(boardId, state, SnapshotKind.Auto, elementCount, cancellationToken);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            AutomaticFailed(logger, boardId, e.GetType().Name);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "The automatic snapshot of board {BoardId} failed: {Error}.")]
    private static partial void AutomaticFailed(ILogger logger, Guid boardId, string error);

    /// <summary>Whether a save should be preceded by an automatic snapshot of the old state.</summary>
    public async Task<bool> IsAutomaticDueAsync(Guid boardId, CancellationToken cancellationToken)
    {
        var newest = await snapshots.NewestAtAsync(boardId, cancellationToken);
        return newest is null || time.GetUtcNow() - newest.Value >= AutomaticInterval;
    }

    /// <summary>Removes the rows (committed) and then their objects.</summary>
    public async Task RemoveAsync(IReadOnlyCollection<BoardSnapshot> doomed, CancellationToken cancellationToken)
    {
        if (doomed.Count == 0)
        {
            return;
        }

        foreach (var snapshot in doomed)
        {
            snapshots.Remove(snapshot);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        foreach (var snapshot in doomed)
        {
            await store.DeleteAsync(FileTypes.SnapshotKey(snapshot.BoardId, snapshot.Id), cancellationToken);
        }
    }

    /// <summary>The ungzipped Yjs state of a snapshot, or null when its object is missing.</summary>
    public async Task<byte[]?> ReadStateAsync(BoardSnapshot snapshot, CancellationToken cancellationToken)
    {
        await using var file =
            await store.GetAsync(FileTypes.SnapshotKey(snapshot.BoardId, snapshot.Id), cancellationToken);
        if (file is null)
        {
            return null;
        }

        await using var gzip = new GZipStream(file.Content, CompressionMode.Decompress);
        using var buffer = new MemoryStream();
        await gzip.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }

    private async Task<BoardSnapshot> StoreAsync(
        Guid boardId,
        byte[] state,
        SnapshotKind kind,
        string? name,
        string? subject,
        int? elementCount,
        CancellationToken cancellationToken)
    {
        var id = Guid.CreateVersion7();
        var packed = Gzip(state);
        using (var content = new MemoryStream(packed, false))
        {
            await store.PutAsync(FileTypes.SnapshotKey(boardId, id), content, "application/gzip", cancellationToken);
        }

        var snapshot = new BoardSnapshot
        {
            Id = id,
            BoardId = boardId,
            Name = name,
            Kind = kind,
            CreatedBy = subject,
            CreatedAt = time.GetUtcNow(),
            SizeBytes = packed.Length,
            ElementCount = elementCount,
        };
        snapshots.Add(snapshot);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return snapshot;
    }

    private static byte[] Gzip(byte[] bytes)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, true))
        {
            gzip.Write(bytes);
        }

        return output.ToArray();
    }
}
