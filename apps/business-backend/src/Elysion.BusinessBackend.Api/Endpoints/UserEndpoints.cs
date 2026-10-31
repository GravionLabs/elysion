using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data.Repositories;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Finding people to share with (ADR 0027, #663). Any signed-in person may look for somebody by name or email; the answer is the
/// id, the name and the email, at most <see cref="MaxResults"/>, and a query needs <see cref="MinQueryLength"/> characters, so
/// the directory cannot be listed. It shows names and emails of everybody who has logged in to everybody who has logged in: that
/// is what the product decided; <see cref="IUserRepository.SearchAsync"/> is the one place to narrow it.
/// </summary>
public static class UserEndpoints
{
    public const int MinQueryLength = 2;
    public const int MaxQueryLength = 100;
    public const int MaxResults = 10;

    public static IEndpointRouteBuilder MapUserEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/users", Search).WithName("SearchUsers").WithTags("Users");
        return routes;
    }

    private static async Task<IResult> Search(string? query,
        IUserRepository users,
        CancellationToken cancellationToken)
    {
        var text = query?.Trim() ?? string.Empty;
        if (text.Length < MinQueryLength || text.Length > MaxQueryLength)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["query"] = [$"Type {MinQueryLength} to {MaxQueryLength} characters of the name or the email."]
            });
        }

        var found = await users.SearchAsync(text, MaxResults, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<UserDto>>(
            found.Select(u => new UserDto(u.Id, u.DisplayName, u.Email, u.IsIntegration)).ToList());
    }
}
