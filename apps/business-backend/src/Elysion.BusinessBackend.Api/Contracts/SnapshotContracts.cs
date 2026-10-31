namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A version of a board in the history (ADR 0032). <c>Author</c> is null for an automatic one.</summary>
public record SnapshotDto(
    Guid Id,
    string Kind,
    string? Name,
    string? Author,
    DateTimeOffset CreatedAt,
    long SizeBytes,
    int? ElementCount);

/// <summary>The body of "Save version"; the name is optional.</summary>
public record CreateSnapshotRequest(string? Name);

public record RenameSnapshotRequest(string? Name);

/// <summary>The answer to a restore: the "Before restore" version that was kept first, or null when the board had no stored state.</summary>
public record RestoreSnapshotResponse(SnapshotDto? Before);
