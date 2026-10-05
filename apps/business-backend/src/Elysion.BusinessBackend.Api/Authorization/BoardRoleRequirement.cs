using Elysion.BusinessBackend.Api.Entities;
using Microsoft.AspNetCore.Authorization;

namespace Elysion.BusinessBackend.Api.Authorization;

/// <summary>The caller needs at least this role on the board named by the route's <c>id</c>.</summary>
public sealed record BoardRoleRequirement(BoardRole Minimum) : IAuthorizationRequirement;
