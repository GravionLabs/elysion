using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>A template in the list: no scene.</summary>
public sealed record TemplateSummaryDto(
    Guid Id,
    string Name,
    string Description,
    bool IsBuiltIn,
    DateTimeOffset CreatedAt)
{
    public static TemplateSummaryDto From(Template template) =>
        new(template.Id, template.Name, template.Description, template.IsBuiltIn, template.CreatedAt);
}

/// <summary>One template with its scene, the text of an <c>.excalidraw</c> file.</summary>
public sealed record TemplateDto(
    Guid Id,
    string Name,
    string Description,
    bool IsBuiltIn,
    DateTimeOffset CreatedAt,
    string Scene)
{
    public static TemplateDto From(Template template) =>
        new(template.Id, template.Name, template.Description, template.IsBuiltIn, template.CreatedAt, template.Scene);
}

/// <summary>Body for saving a user template. Name, description and scene are checked by the endpoint.</summary>
public sealed record CreateTemplateRequest(string? Name, string? Description, string? Scene);
