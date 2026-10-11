namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>Body for making an invitation link: <c>Editor</c> or <c>Viewer</c>, how long it works (1 to 720 hours) and, optionally, how many people may use it (1 to 1000).</summary>
public sealed record CreateInvitationRequest(string? Role, int? ExpiresInHours, int? MaxUses);

/// <summary>An active link as the list shows it: never the token, which only the answer to its creation holds.</summary>
public sealed record InvitationDto(
    Guid Id,
    string Role,
    DateTimeOffset ExpiresAt,
    int? MaxUses,
    int Uses,
    DateTimeOffset CreatedAt);

/// <summary>The answer to making a link: the one time the token is shown. <c>Url</c> is for a client that is told the public address; the backend does not know it.</summary>
public sealed record CreatedInvitationDto(
    Guid Id,
    string Token,
    string? Url,
    string Role,
    DateTimeOffset ExpiresAt,
    int? MaxUses,
    int Uses,
    DateTimeOffset CreatedAt);

/// <summary>What following a link did: the board (<c>board</c>) or room (<c>room</c>) and the role the person has there now.</summary>
public sealed record AcceptedInvitationDto(string Kind, Guid Id, string Role);
