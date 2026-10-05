using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>
/// The three questions an endpoint can ask about a board. Endpoints name the policy they need; the role
/// logic lives in one place (<see cref="BoardAuthorizationHandler"/>).
/// </summary>
public static class BoardPolicies
{
    /// <summary>See the board: Viewer, Editor or Owner.</summary>
    public const string Read = "BoardRead";

    /// <summary>Change its content or name: Editor or Owner.</summary>
    public const string Write = "BoardWrite";

    /// <summary>Administer it (delete, share): Owner only.</summary>
    public const string Administer = "BoardAdminister";

    /// <summary>How much a role may do; higher is more. Explicit, so reordering <see cref="BoardRole"/> cannot change a decision.</summary>
    public static int Rank(BoardRole role) => role switch
    {
        BoardRole.Viewer => 1,
        BoardRole.Editor => 2,
        BoardRole.Owner => 3,
        _ => 0,
    };
}
