namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>
/// The questions an endpoint can ask about a room, the same three as for boards (<see cref="BoardPolicies"/>,
/// whose <see cref="BoardPolicies.Rank"/> orders the roles): the role logic lives in
/// <see cref="RoomAuthorizationHandler"/>.
/// </summary>
public static class RoomPolicies
{
    /// <summary>See the room: Viewer, Editor or Owner.</summary>
    public const string Read = "RoomRead";

    /// <summary>Rename it: Editor or Owner.</summary>
    public const string Write = "RoomWrite";

    /// <summary>Delete it and manage its members: Owner only.</summary>
    public const string Administer = "RoomAdminister";
}
