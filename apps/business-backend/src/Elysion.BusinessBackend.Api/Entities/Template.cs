using System.Text.Json;

using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A starting point for a board: a named scene stored as the text of an <c>.excalidraw</c> file. Built-in
/// templates ship with the service (seeded by a migration from the embedded files in <c>Templates/</c>) and
/// belong to nobody; a user template is private to the user who saved it.
/// </summary>
public class Template
{
    public const int MaxNameLength = 120;
    public const int MaxDescriptionLength = 500;

    /// <summary>The longest scene accepted, in characters: a few thousand elements, far above any template.</summary>
    public const int MaxSceneLength = 5_000_000;

    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }

    /// <summary>The scene as an <c>.excalidraw</c> JSON document.</summary>
    public required string Scene { get; set; }

    public bool IsBuiltIn { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Who saved the template; null for a built-in one. Deleting the user deletes their templates.</summary>
    public Guid? OwnerId { get; set; }

    public User? Owner { get; set; }

    public static Template Create(Guid id,
        string name,
        string description,
        string scene,
        bool isBuiltIn,
        DateTimeOffset createdAt,
        Guid? ownerId = null)
    {
        Guard.Against.Default(id);
        Guard.Against.NullOrWhiteSpace(name);
        Guard.Against.StringTooLong(name, MaxNameLength);
        Guard.Against.Null(description);
        Guard.Against.StringTooLong(description, MaxDescriptionLength);
        Guard.Against.NullOrWhiteSpace(scene);
        Guard.Against.StringTooLong(scene, MaxSceneLength);
        if (ownerId is { } owner)
        {
            Guard.Against.Default(owner, nameof(ownerId));
        }

        Guard.Against.InvalidInput(scene, nameof(scene), IsValidScene);
        Guard.Against.InvalidInput(isBuiltIn, nameof(isBuiltIn), builtIn => builtIn == (ownerId is null));
        return new Template
        {
            Id = id,
            Name = name.Trim(),
            Description = description,
            Scene = scene,
            IsBuiltIn = isBuiltIn,
            CreatedAt = createdAt,
            OwnerId = ownerId,
        };
    }

    /// <summary>
    /// Whether the text is an <c>.excalidraw</c> file: a JSON object of type <c>excalidraw</c> with an
    /// <c>elements</c> array. The one rule for what may be stored (request validation uses it to answer 400).
    /// </summary>
    public static bool IsValidScene(string? scene)
    {
        if (string.IsNullOrWhiteSpace(scene) || scene.Length > MaxSceneLength)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(scene);
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object
                   && root.TryGetProperty("type", out var type)
                   && type.ValueKind == JsonValueKind.String
                   && type.GetString() == "excalidraw"
                   && root.TryGetProperty("elements", out var elements)
                   && elements.ValueKind == JsonValueKind.Array;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>The single rule for a template name: trimmed, 1 to <see cref="MaxNameLength"/> characters.</summary>
    public static bool TryNormalizeName(string? raw, out string name)
    {
        name = raw?.Trim() ?? string.Empty;
        return name.Length is >= 1 and <= MaxNameLength;
    }
}
