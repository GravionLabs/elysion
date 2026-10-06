using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

/// <summary>What <see cref="IBoardDocumentRepository.SaveAsync"/> did.</summary>
public enum DocumentSaveStatus
{
    /// <summary>Stored; <see cref="DocumentSaveResult.Document"/> is the stored document with its new version.</summary>
    Saved,

    /// <summary>An update named a document that does not exist.</summary>
    NotFound,

    /// <summary>
    /// The stored version is not the one the save was based on (or the document exists for a first save).
    /// <see cref="DocumentSaveResult.Document"/> is what is stored now, null if it vanished meanwhile.
    /// </summary>
    Conflict,
}

public readonly record struct DocumentSaveResult(DocumentSaveStatus Status, BoardDocument? Document);

/// <summary>
/// The Yjs state of boards (ADR 0011). A save is versioned: the writer names the version its state is based
/// on, and a stale one is a conflict, never an overwrite.
/// </summary>
public interface IBoardDocumentRepository
{
    /// <summary>The stored document, or null; a copy that is not tracked.</summary>
    Task<BoardDocument?> FindAsync(string boardId, CancellationToken cancellationToken);

    /// <summary>
    /// Stores <paramref name="state"/> and commits at once. <paramref name="expectedVersion"/> is the version
    /// the state is based on; null is a first save, which conflicts when a document exists already. A write
    /// that loses a race against another writer is a <see cref="DocumentSaveStatus.Conflict"/> too.
    /// </summary>
    Task<DocumentSaveResult> SaveAsync(
        string boardId,
        byte[] state,
        long? expectedVersion,
        DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>Stages a new document (the copy of a duplicated board).</summary>
    void Add(BoardDocument document);

    /// <summary>Stages the removal of a board's document, if it has one. Returns whether there was one.</summary>
    Task<bool> RemoveAsync(string boardId, CancellationToken cancellationToken);
}
