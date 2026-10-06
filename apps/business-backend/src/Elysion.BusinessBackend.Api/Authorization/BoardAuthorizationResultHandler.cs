using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>
/// Turns "the caller has no role on this board" into <c>404 Not Found</c> instead of <c>403 Forbidden</c>.
/// </summary>
/// <remarks>
/// This is a deliberate choice, not an oversight to "fix": with a 403 anyone could probe board ids and learn
/// which ones exist. A non-member must not be able to tell a board they may not see from one that is not there.
/// Everything else (not signed in, a role that is too low) keeps the default answers (401, 403).
/// </remarks>
public sealed class BoardAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    /// <summary>The failure reason that marks "no role on this board".</summary>
    public const string NotVisible = "The board does not exist for this user.";

    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public Task HandleAsync(RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Forbidden
            && authorizeResult.AuthorizationFailure?.FailureReasons.Any(reason => reason.Message == NotVisible) == true)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }

        return _default.HandleAsync(next, context, policy, authorizeResult);
    }
}
