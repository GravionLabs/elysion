using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data.Repositories;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>The template catalog for signed-in users: the list without scenes, one template with its scene.</summary>
public static class TemplateEndpoints
{
    public static IEndpointRouteBuilder MapTemplateEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/templates").WithTags("Templates");

        group.MapGet("", List).WithName("ListTemplates");
        group.MapGet("/{id:guid}", Get).WithName("GetTemplate");
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<TemplateSummaryDto>>> List(ITemplateRepository templates,
        CancellationToken cancellationToken)
    {
        var all = await templates.ListAsync(cancellationToken);
        return TypedResults.Ok<IReadOnlyList<TemplateSummaryDto>>(all.Select(TemplateSummaryDto.From).ToList());
    }

    private static async Task<Results<Ok<TemplateDto>, NotFound>> Get(Guid id,
        ITemplateRepository templates,
        CancellationToken cancellationToken)
    {
        var template = await templates.FindAsync(id, cancellationToken);
        return template is null ? TypedResults.NotFound() : TypedResults.Ok(TemplateDto.From(template));
    }
}
