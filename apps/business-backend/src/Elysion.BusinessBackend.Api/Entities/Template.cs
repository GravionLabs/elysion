using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A starting point for a board: a named scene stored as the text of an <c>.excalidraw</c> file. Built-in
/// templates ship with the service (seeded by a migration from the embedded files in <c>Templates/</c>);
/// user templates (#340) come later.
/// </summary>
public class Template
{
    public const int MaxNameLength = 120;
    public const int MaxDescriptionLength = 500;

    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }

    /// <summary>The scene as an <c>.excalidraw</c> JSON document.</summary>
    public required string Scene { get; set; }

    public bool IsBuiltIn { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public static Template Create(Guid id,
        string name,
        string description,
        string scene,
        bool isBuiltIn,
        DateTimeOffset createdAt)
    {
        Guard.Against.Default(id);
        Guard.Against.NullOrWhiteSpace(name);
        Guard.Against.StringTooLong(name, MaxNameLength);
        Guard.Against.Null(description);
        Guard.Against.StringTooLong(description, MaxDescriptionLength);
        Guard.Against.NullOrWhiteSpace(scene);
        return new Template
        {
            Id = id,
            Name = name.Trim(),
            Description = description,
            Scene = scene,
            IsBuiltIn = isBuiltIn,
            CreatedAt = createdAt,
        };
    }
}
