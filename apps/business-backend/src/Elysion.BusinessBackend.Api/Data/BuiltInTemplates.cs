using System.Reflection;

using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Data;

/// <summary>
/// The templates every installation starts with. Their scenes are the embedded <c>Templates/*.excalidraw</c>
/// files, made of the canvas's own sticky notes. Ids and dates are fixed so the seed is the same in every
/// database and migration.
/// </summary>
public static class BuiltInTemplates
{
    private static readonly DateTimeOffset SeededAt = new(2026, 10, 6, 0, 0, 0, TimeSpan.Zero);

    private static readonly (string Id, string Resource, string Name, string Description)[] Definitions =
    [
        ("0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b01", "retrospective", "Retrospective",
            "Three columns for what went well, what to improve and the actions that follow."),
        ("0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b02", "kanban", "Kanban",
            "To do, Doing and Done columns with a few task cards."),
        ("0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b03", "brainstorming", "Brainstorming",
            "A topic in the middle with room for ideas around it."),
    ];

    public static IReadOnlyList<Template> All() =>
    [
        .. Definitions.Select(d =>
            Template.Create(Guid.Parse(d.Id), d.Name, d.Description, ReadScene(d.Resource), true, SeededAt))
    ];

    private static string ReadScene(string resource)
    {
        var assembly = typeof(BuiltInTemplates).Assembly;
        var name = assembly.GetManifestResourceNames()
            .Single(n => n.EndsWith($".{resource}.excalidraw", StringComparison.Ordinal));
        using var reader = new StreamReader(assembly.GetManifestResourceStream(name)!);
        return reader.ReadToEnd();
    }
}
