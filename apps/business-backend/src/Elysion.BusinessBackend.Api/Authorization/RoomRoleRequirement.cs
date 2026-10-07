using Elysion.BusinessBackend.Api.Entities;

using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>The caller needs at least this role in the room named by the route's <c>id</c>.</summary>
public sealed record RoomRoleRequirement(BoardRole Minimum) : IAuthorizationRequirement;
