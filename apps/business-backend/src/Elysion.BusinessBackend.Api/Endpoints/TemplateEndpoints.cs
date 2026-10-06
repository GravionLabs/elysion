using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// The template catalog for signed-in users: the built-in templates and the caller's own. Reading lists without
/// scenes, one template comes with its scene. A user saves their own templates and deletes them; built-in
/// templates cannot be deleted, and another user's templates do not exist as far as the caller can tell.
/// </summary>
public static class TemplateEndpoints
{
    public static IEndpointRouteBuilder MapTemplateEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/templates").WithTags("Templates");

        group.MapGet("", List).WithName("ListTemplates");
        group.MapGet("/{id:guid}", Get).WithName("GetTemplate");
        group.MapPost("", Create)
            .WithName("CreateTemplate")
            .Accepts<CreateTemplateRequest>("application/json")
            .RequireJsonContentType();
        group.MapDelete("/{id:guid}", Delete).WithName("DeleteTemplate");
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<TemplateSummaryDto>>> List(ITemplateRepository templates,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var all = await templates.ListVisibleToAsync(user.Id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<TemplateSummaryDto>>(all.Select(TemplateSummaryDto.From).ToList());
    }

    private static async Task<Results<Ok<TemplateDto>, NotFound>> Get(Guid id,
        ITemplateRepository templates,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var template = await templates.FindVisibleAsync(id, user.Id, cancellationToken);
        return template is null ? TypedResults.NotFound() : TypedResults.Ok(TemplateDto.From(template));
    }

    private static async Task<Results<Created<TemplateDto>, ValidationProblem>> Create(
        CreateTemplateRequest? request,
        HttpRequest http,
        ITemplateRepository templates,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (!Template.TryNormalizeName(request?.Name, out var name))
        {
            errors["name"] = [$"The name must be between 1 and {Template.MaxNameLength} characters."];
        }

        var description = request?.Description?.Trim() ?? string.Empty;
        if (description.Length > Template.MaxDescriptionLength)
        {
            errors["description"] = [$"The description can have up to {Template.MaxDescriptionLength} characters."];
        }

        if (!Template.IsValidScene(request?.Scene))
        {
            errors["scene"] =
                [$"The scene must be an .excalidraw file of at most {Template.MaxSceneLength} characters."];
        }

        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var now = time.GetUtcNow();
        var template = Template.Create(Guid.CreateVersion7(),
            name,
            description,
            request!.Scene!,
            isBuiltIn: false,
            new DateTimeOffset(now.Ticks - now.Ticks % 10, now.Offset), // what Postgres keeps
            user.Id);
        templates.Add(template);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var location = UriHelper.BuildAbsolute(http.Scheme, http.Host, http.PathBase, $"/templates/{template.Id}");
        return TypedResults.Created(location, TemplateDto.From(template));
    }

    /// <summary>204 for the caller's own template; 403 for a built-in one (it is visible, but nobody's to delete); 404 otherwise.</summary>
    private static async Task<Results<NoContent, NotFound, ForbidHttpResult>> Delete(Guid id,
        ITemplateRepository templates,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var template = await templates.FindVisibleAsync(id, user.Id, cancellationToken);
        if (template is null)
        {
            return TypedResults.NotFound();
        }

        if (template.IsBuiltIn)
        {
            return TypedResults.Forbid();
        }

        templates.Remove(template);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }
}
