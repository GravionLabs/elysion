using Ardalis.GuardClauses;

using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data.Repositories;

public sealed class BoardDocumentRepository(ElysionDbContext db) : IBoardDocumentRepository
{
    public async Task<BoardDocument?> FindAsync(string boardId, CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(boardId);
        return await db.BoardDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
    }

    public async Task<DocumentSaveResult> SaveAsync(
        string boardId,
        byte[] state,
        long? expectedVersion,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(boardId);
        Guard.Against.Null(state);
        if (expectedVersion is { } version)
        {
            Guard.Against.NegativeOrZero(version, nameof(expectedVersion));
        }

        var document = await db.BoardDocuments.FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
        if (expectedVersion is null)
        {
            if (document is not null)
                return new(DocumentSaveStatus.Conflict, document);
            document = new BoardDocument { BoardId = boardId, State = state, Version = 1, UpdatedAt = now };
            db.BoardDocuments.Add(document);
        }
        else
        {
            if (document is null)
                return new(DocumentSaveStatus.NotFound, null);
            if (document.Version != expectedVersion)
                return new(DocumentSaveStatus.Conflict, document);

            document.State = state;
            document.Version = expectedVersion.Value + 1;
            document.UpdatedAt = now;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is DbUpdateConcurrencyException or DbUpdateException)
        {
            // Another request saved between our read and our write: hand back what is stored now.
            db.ChangeTracker.Clear();
            var current = await db.BoardDocuments.AsNoTracking()
                .FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
            return new(DocumentSaveStatus.Conflict, current);
        }

        return new(DocumentSaveStatus.Saved, document);
    }

    public void Add(BoardDocument document) => db.BoardDocuments.Add(Guard.Against.Null(document));

    public async Task<bool> RemoveAsync(string boardId, CancellationToken cancellationToken)
    {
        Guard.Against.NullOrWhiteSpace(boardId);
        var document = await db.BoardDocuments.FirstOrDefaultAsync(d => d.BoardId == boardId, cancellationToken);
        if (document is null)
            return false;
        db.BoardDocuments.Remove(document);
        return true;
    }
}
