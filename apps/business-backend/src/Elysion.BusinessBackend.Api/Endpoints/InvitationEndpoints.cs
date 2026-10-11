using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Invitations;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Invitation links (#734). Making, listing and revoking them is sharing, so it needs the administer policy of the board or
/// room (Owner; a stranger gets 404, a lower role 403). Following one needs only a signed-in person: the token is the
/// authority. The token is shown once, in the answer to its creation, and stored as a hash.
/// </summary>
public static class InvitationEndpoints
{
    public static IEndpointRouteBuilder MapInvitationEndpoints(this IEndpointRouteBuilder routes)
    {
        MapTarget(routes.MapGroup("/boards/{id:guid}/invitations")
                .WithTags("Invitations")
                .RequireAuthorization(BoardPolicies.Administer),
            isBoard: true);
        MapTarget(routes.MapGroup("/rooms/{id:guid}/invitations")
                .WithTags("Invitations")
                .RequireAuthorization(RoomPolicies.Administer),
            isBoard: false);

        // Any signed-in person (the fallback policy): the token is the authority, not a role.
        routes.MapPost("/invitations/{token}/accept", Accept).WithName("AcceptInvitation").WithTags("Invitations");
        return routes;
    }

    private static void MapTarget(RouteGroupBuilder group, bool isBoard)
    {
        var noun = isBoard ? "Board" : "Room";
        group.MapGet("",
                (Guid id, IInvitationRepository invitations, TimeProvider time, CancellationToken ct) =>
                    List(isBoard ? id : null, isBoard ? null : id, invitations, time, ct))
            .WithName($"List{noun}Invitations");
        group.MapPost("",
                (Guid id,
                        CreateInvitationRequest? request,
                        IInvitationRepository invitations,
                        IAuditLog audit,
                        IUnitOfWork unitOfWork,
                        ICurrentUser user,
                        TimeProvider time,
                        CancellationToken ct) =>
                    Create(isBoard ? id : null,
                        isBoard ? null : id,
                        request,
                        invitations,
                        audit,
                        unitOfWork,
                        user,
                        time,
                        ct))
            .WithName($"Create{noun}Invitation")
            .Accepts<CreateInvitationRequest>("application/json")
            .RequireJsonContentType();
        group.MapDelete("/{invitationId:guid}",
                (Guid id,
                        Guid invitationId,
                        IInvitationRepository invitations,
                        IAuditLog audit,
                        IUnitOfWork unitOfWork,
                        TimeProvider time,
                        CancellationToken ct) =>
                    Revoke(isBoard ? id : null,
                        isBoard ? null : id,
                        invitationId,
                        invitations,
                        audit,
                        unitOfWork,
                        time,
                        ct))
            .WithName($"Revoke{noun}Invitation");
    }

    private static async Task<Ok<IReadOnlyList<InvitationDto>>> List(Guid? boardId,
        Guid? roomId,
        IInvitationRepository invitations,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var active = await invitations.ListActiveAsync(boardId, roomId, time.GetUtcNow(), cancellationToken);
        return TypedResults.Ok<IReadOnlyList<InvitationDto>>(active.Select(ToDto).ToList());
    }

    private static async Task<IResult> Create(Guid? boardId,
        Guid? roomId,
        CreateInvitationRequest? request,
        IInvitationRepository invitations,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        var role = BoardRole.Viewer;
        var roleName = request?.Role?.Trim();
        if (!string.Equals(roleName, nameof(BoardRole.Editor), StringComparison.OrdinalIgnoreCase)
            && !string.Equals(roleName, nameof(BoardRole.Viewer), StringComparison.OrdinalIgnoreCase))
        {
            errors["role"] = ["The role of a link must be Editor or Viewer."];
        }
        else
        {
            role = string.Equals(roleName, nameof(BoardRole.Editor), StringComparison.OrdinalIgnoreCase)
                ? BoardRole.Editor
                : BoardRole.Viewer;
        }

        if (request?.ExpiresInHours is not (>= Invitation.MinHours and <= Invitation.MaxHours))
        {
            errors["expiresInHours"] =
                [$"A link works for {Invitation.MinHours} to {Invitation.MaxHours} hours (30 days)."];
        }

        if (request?.MaxUses is not null and not (>= 1 and <= Invitation.MaxUsesLimit))
        {
            errors["maxUses"] = [$"The number of uses must be from 1 to {Invitation.MaxUsesLimit}, or left out."];
        }

        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var now = time.GetUtcNow();
        var active = await invitations.ListActiveAsync(boardId, roomId, now, cancellationToken);
        if (active.Count >= Invitation.MaxActivePerTarget)
        {
            return TypedResults.Problem(
                $"There are {Invitation.MaxActivePerTarget} active links already. Revoke one before making another.",
                statusCode: StatusCodes.Status409Conflict,
                title: "Invitation limit reached");
        }

        var token = InvitationTokens.Generate();
        var invitation = new Invitation
        {
            Id = Guid.CreateVersion7(),
            TokenHash = InvitationTokens.Hash(token),
            BoardId = boardId,
            RoomId = roomId,
            Role = role,
            ExpiresAt = now.AddHours(request!.ExpiresInHours!.Value),
            MaxUses = request.MaxUses,
            CreatedByUserId = user.Id,
            CreatedAt = now,
        };
        invitations.Add(invitation);
        audit.Record(AuditActions.InvitationCreated,
            boardId is not null ? AuditActions.Board : AuditActions.Room,
            boardId ?? roomId,
            new { invitationId = invitation.Id, role = role.ToString(), invitation.ExpiresAt, invitation.MaxUses });
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var path = boardId is not null ? $"/boards/{boardId}/invitations" : $"/rooms/{roomId}/invitations";
        return TypedResults.Created($"{path}/{invitation.Id}",
            new CreatedInvitationDto(invitation.Id,
                token,
                null,
                role.ToString(),
                invitation.ExpiresAt,
                invitation.MaxUses,
                invitation.Uses,
                invitation.CreatedAt));
    }

    private static async Task<IResult> Revoke(Guid? boardId,
        Guid? roomId,
        Guid invitationId,
        IInvitationRepository invitations,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var invitation = await invitations.FindForUpdateAsync(boardId, roomId, invitationId, cancellationToken);
        if (invitation is null)
        {
            return TypedResults.NotFound();
        }

        if (invitation.RevokedAt is null)
        {
            invitation.RevokedAt = time.GetUtcNow();
            audit.Record(AuditActions.InvitationRevoked,
                boardId is not null ? AuditActions.Board : AuditActions.Room,
                boardId ?? roomId,
                new { invitationId });
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return TypedResults.NoContent();
    }

    private static async Task<IResult> Accept(string token,
        InvitationService service,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var result = await service.AcceptAsync(token, user.Id, cancellationToken);
        return result.Outcome switch
        {
            AcceptOutcome.Unknown => TypedResults.Problem("This invitation link does not exist.",
                statusCode: StatusCodes.Status404NotFound,
                title: "Invitation not found"),
            AcceptOutcome.Gone => TypedResults.Problem("This invitation link has expired, was revoked or is used up.",
                statusCode: StatusCodes.Status410Gone,
                title: "Invitation no longer valid"),
            _ => TypedResults.Ok(new AcceptedInvitationDto(result.Kind, result.TargetId, result.Role.ToString())),
        };
    }

    private static InvitationDto ToDto(Invitation i) =>
        new(i.Id, i.Role.ToString(), i.ExpiresAt, i.MaxUses, i.Uses, i.CreatedAt);
}
