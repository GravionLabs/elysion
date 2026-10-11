using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Finding groups (ADR 0027, #647). Any signed-in person may look for a group by name, to give it a role on a room; the answer
/// has names and ids, never members. Making, linking, renaming and deleting groups is for administrators (#655).
/// </summary>
public static class GroupEndpoints
{
    public const int MinQueryLength = 2;
    public const int MaxResults = 20;

    public static IEndpointRouteBuilder MapGroupEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/groups", Search).WithName("SearchGroups").WithTags("Groups");
        routes.MapGet("/me/groups", Mine).WithName("ListMyGroups").WithTags("Groups");
        return routes;
    }

    private static async Task<IResult> Search(string? query,
        IGroupRepository groups,
        CancellationToken cancellationToken)
    {
        var text = query?.Trim() ?? string.Empty;
        if (text.Length < MinQueryLength)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["query"] = [$"Type at least {MinQueryLength} characters of the group's name."]
            });
        }

        var found = await groups.SearchAsync(text, MaxResults, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<GroupDto>>(found.Select(GroupDto.From).ToList());
    }

    private static async Task<Ok<IReadOnlyList<GroupDto>>> Mine(
        IGroupRepository groups,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var mine = await groups.GetForUserAsync(user.Id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<GroupDto>>(mine.Select(GroupDto.From).ToList());
    }
}
