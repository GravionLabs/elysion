using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Members;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Endpoints.Admin;

/// <summary>
/// The administration of the instance (ADR 0027, #656): people, groups, rooms and a few numbers, for the holders of the realm role
/// <c>OIDC_ADMIN_ROLE</c>. Everything here is <b>metadata</b>: names, counts, roles, dates. Nothing returns what is on a board, and the
/// role does not make anybody a member of anything, so an administrator who is not a member still gets 404 for a board. A caller
/// without the role gets 403: the area is not secret, the content is.
/// </summary>
public static class AdminEndpoints
{
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;
    public const int MaxQueryLength = 100;

    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder routes)
    {
        var admin = routes.MapGroup("/admin")
            .WithTags("Administration")
            .RequireAuthorization(AdminPolicies.InstanceAdminister);

        admin.MapGet("/stats", Stats).WithName("AdminStats");

        admin.MapGet("/users", ListUsers).WithName("AdminListUsers");
        admin.MapGet("/users/{id:guid}", GetUser).WithName("AdminGetUser");

        admin.MapPost("/users/{id:guid}/deactivate", DeactivateUser).WithName("AdminDeactivateUser");
        admin.MapPost("/users/{id:guid}/reactivate", ReactivateUser).WithName("AdminReactivateUser");
        admin.MapPost("/boards/transfer", TransferOwnership)
            .WithName("AdminTransferOwnership")
            .Accepts<AdminTransferRequest>("application/json")
            .RequireJsonContentType();

        admin.MapGet("/groups", ListGroups).WithName("AdminListGroups");
        admin.MapPost("/groups", CreateGroup)
            .WithName("AdminCreateGroup")
            .Accepts<AdminGroupCreateRequest>("application/json")
            .RequireJsonContentType();
        admin.MapPatch("/groups/{id:guid}", PatchGroup)
            .WithName("AdminPatchGroup")
            .Accepts<JsonElement>("application/json")
            .RequireJsonContentType();
        admin.MapDelete("/groups/{id:guid}", DeleteGroup).WithName("AdminDeleteGroup");
        admin.MapGet("/groups/{id:guid}/members", ListGroupMembers).WithName("AdminListGroupMembers");
        admin.MapGet("/groups/{id:guid}/pending", ListGroupPending).WithName("AdminListGroupPending");
        admin.MapGet("/graph", GraphStatus).WithName("AdminGraphStatus");
        admin.MapPut("/groups/{id:guid}/members/{userId:guid}", AddGroupMember).WithName("AdminAddGroupMember");
        admin.MapDelete("/groups/{id:guid}/members/{userId:guid}", RemoveGroupMember)
            .WithName("AdminRemoveGroupMember");

        admin.MapGet("/rooms", ListRooms).WithName("AdminListRooms");

        admin.MapGet("/audit", ListAudit).WithName("AdminListAudit");
        return routes;
    }

    /// <summary>The page and its size as asked, kept inside what the area serves; a value that makes no sense is the default.</summary>
    private static (int Page, int PageSize) Paging(int? page, int? pageSize) =>
        (page is > 0 ? page.Value : 1, pageSize is > 0 ? Math.Min(pageSize.Value, MaxPageSize) : DefaultPageSize);

    private static string? Query(string? query)
    {
        var text = query?.Trim();
        return string.IsNullOrEmpty(text) ? null : text.Length > MaxQueryLength ? text[..MaxQueryLength] : text;
    }

    private static async Task<Ok<AdminStatsDto>> Stats(IAdminRepository admin,
        TimeProvider time,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await admin.GetStatsAsync(time.GetUtcNow(), cancellationToken));

    /// <summary>The people and integrations; <c>?kind=person</c> or <c>?kind=integration</c> keeps one of them (#851), anything else both.</summary>
    private static async Task<Ok<PagedResult<AdminUserDto>>> ListUsers(string? query,
        string? kind,
        int? page,
        int? pageSize,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        var (p, size) = Paging(page, pageSize);
        bool? integrations = kind switch
        {
            "integration" => true,
            "person" => false,
            _ => null,
        };
        return TypedResults.Ok(await admin.ListUsersAsync(Query(query), integrations, p, size, cancellationToken));
    }

    private static async Task<IResult> GetUser(Guid id, IAdminRepository admin, CancellationToken cancellationToken)
    {
        var user = await admin.GetUserAsync(id, cancellationToken);
        return user is null ? NotFound("There is no such person.") : TypedResults.Ok(user);
    }

    /// <summary>
    /// Deactivates a person (#668): every request of theirs is refused from now on. 409 for the caller themselves. The identity
    /// provider is not told, so the account has to be disabled there too. Answers the person's detail.
    /// </summary>
    private static async Task<IResult> DeactivateUser(Guid id,
        UserLifecycleService lifecycle,
        IAdminRepository admin,
        ICurrentUser caller,
        CancellationToken cancellationToken)
    {
        var result = await lifecycle.DeactivateAsync(id, caller.Id, cancellationToken);
        return await LifecycleAnswerAsync(result, id, admin, cancellationToken);
    }

    private static async Task<IResult> ReactivateUser(Guid id,
        UserLifecycleService lifecycle,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        var result = await lifecycle.ReactivateAsync(id, cancellationToken);
        return await LifecycleAnswerAsync(result, id, admin, cancellationToken);
    }

    private static async Task<IResult> LifecycleAnswerAsync(LifecycleResult result,
        Guid id,
        IAdminRepository admin,
        CancellationToken cancellationToken) =>
        result.Outcome switch
        {
            LifecycleOutcome.Done => TypedResults.Ok(await admin.GetUserAsync(id, cancellationToken)),
            LifecycleOutcome.Self => TypedResults.Problem(
                "You cannot deactivate yourself: nobody would be left to undo it.",
                statusCode: StatusCodes.Status409Conflict),
            _ => NotFound("There is no such person."),
        };

    /// <summary>
    /// Hands the boards and rooms a deactivated person owned over to another person (#668): the new owner gets the Owner role, the
    /// previous owner keeps nothing. The administrator who does it gets no role. 409 while the giver is still active, or when the
    /// receiver is deactivated or the same person.
    /// </summary>
    private static async Task<IResult> TransferOwnership(AdminTransferRequest? request,
        UserLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        if (request is null || request.FromUserId == Guid.Empty || request.ToUserId == Guid.Empty)
        {
            return Invalid("body", "Send fromUserId and toUserId.");
        }

        var result = await lifecycle.TransferAsync(request.FromUserId, request.ToUserId, cancellationToken);
        return result.Outcome switch
        {
            LifecycleOutcome.Done => TypedResults.Ok(new AdminTransferResultDto(result.Boards, result.Rooms)),
            LifecycleOutcome.GiverStillActive => TypedResults.Problem(
                "Deactivate the person first: a hand-over is for somebody who has left.",
                statusCode: StatusCodes.Status409Conflict),
            LifecycleOutcome.InvalidReceiver => TypedResults.Problem(
                "The person who takes over has to be somebody else, and active.",
                statusCode: StatusCodes.Status409Conflict),
            _ => NotFound("There is no such person."),
        };
    }

    private static async Task<Ok<PagedResult<AdminGroupDto>>> ListGroups(string? query,
        int? page,
        int? pageSize,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        var (p, size) = Paging(page, pageSize);
        return TypedResults.Ok(await admin.ListGroupsAsync(Query(query), p, size, cancellationToken));
    }

    private static async Task<IResult> CreateGroup(AdminGroupCreateRequest? request,
        IGroupRepository groups,
        IAdminRepository admin,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (!Group.TryNormalizeName(request?.Name, out var name))
        {
            return NameProblem();
        }

        var group = Group.Create(Guid.CreateVersion7(), name, time.GetUtcNow());
        groups.Add(group);
        audit.Record(AuditActions.GroupCreated, AuditActions.Group, group.Id, new { name });
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var created = await admin.GetGroupAsync(group.Id, cancellationToken);
        return TypedResults.Created($"/admin/groups/{group.Id}", created);
    }

    /// <summary>
    /// <c>{ "name"?, "externalId"? }</c>. A name renames, whatever the source. A string <c>externalId</c> links the group (or
    /// links it to another id); <c>null</c> unlinks it and keeps its members; a body that says neither is a 400.
    /// </summary>
    private static async Task<IResult> PatchGroup(Guid id,
        JsonElement body,
        IGroupRepository groups,
        IGroupSyncRepository groupSync,
        IAdminRepository admin,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            return Invalid("body", "Send a JSON object with a name and/or an externalId.");
        }

        var hasName = body.TryGetProperty("name", out var nameValue);
        var hasExternalId = body.TryGetProperty("externalId", out var externalIdValue);
        if (!hasName && !hasExternalId)
        {
            return Invalid("body", "Send a name and/or an externalId.");
        }

        string? name = null;
        if (hasName)
        {
            if (nameValue.ValueKind != JsonValueKind.String
                || !Group.TryNormalizeName(nameValue.GetString(), out name))
            {
                return NameProblem();
            }
        }

        string? externalId = null;
        if (hasExternalId && externalIdValue.ValueKind != JsonValueKind.Null)
        {
            var raw = externalIdValue.ValueKind == JsonValueKind.String ? externalIdValue.GetString() : null;
            if (string.IsNullOrWhiteSpace(raw) || raw.Trim().Length > Group.MaxExternalIdLength)
            {
                return Invalid("externalId",
                    $"The external id is the claim value of the provider's group: 1 to {Group.MaxExternalIdLength} characters, or null to unlink the group.");
            }

            externalId = raw.Trim();
        }

        var group = await groups.FindForUpdateAsync(id, cancellationToken);
        if (group is null)
        {
            return NotFound("There is no such group.");
        }

        if (externalId is not null && await admin.ExternalIdTakenAsync(externalId, id, cancellationToken))
        {
            return TypedResults.Problem("Another group is linked to this external id.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (name is not null)
        {
            if (name != group.Name)
            {
                audit.Record(AuditActions.GroupRenamed, AuditActions.Group, id, new { from = group.Name, to = name });
            }

            group.Rename(name);
        }

        if (hasExternalId)
        {
            if (externalId is null)
            {
                if (group.Source != GroupSource.Local)
                {
                    audit.Record(AuditActions.GroupUnlinked, AuditActions.Group, id);
                }

                group.Unlink();
                await groupSync.ClearPendingAsync(id, cancellationToken);
            }
            else
            {
                if (group.ExternalId != externalId)
                {
                    audit.Record(AuditActions.GroupLinked, AuditActions.Group, id, new { externalId });
                }

                group.Link(externalId);
            }
        }

        try
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another request took the id between the check and the save: the unique index has the last word.
            return TypedResults.Problem("Another group is linked to this external id.",
                statusCode: StatusCodes.Status409Conflict);
        }

        return TypedResults.Ok(await admin.GetGroupAsync(id, cancellationToken));
    }

    private static async Task<IResult> DeleteGroup(Guid id,
        IGroupRepository groups,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
    {
        var group = await groups.FindForUpdateAsync(id, cancellationToken);
        if (group is null)
        {
            return NotFound("There is no such group.");
        }

        // Its memberships and its roles on rooms go with it (cascade).
        groups.Remove(group);
        audit.Record(AuditActions.GroupDeleted, AuditActions.Group, id, new { name = group.Name });
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>The people the directory lists in the group who have not signed in yet (#667): name and address, for the administrator.</summary>
    private static async Task<IResult> ListGroupPending(Guid id,
        int? page,
        int? pageSize,
        IGroupRepository groups,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        if (await groups.FindAsync(id, cancellationToken) is null)
        {
            return NotFound("There is no such group.");
        }

        var (p, size) = Paging(page, pageSize);
        return TypedResults.Ok(await admin.ListGroupPendingAsync(id, p, size, cancellationToken));
    }

    /// <summary>Whether the Graph sync is switched on, when it last read a group and how many people wait for their first sign-in.</summary>
    private static async Task<Ok<AdminGraphStatusDto>> GraphStatus(IAdminRepository admin,
        IOptions<GraphOptions> options,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await admin.GetGraphStatusAsync(options.Value.Enabled,
            options.Value.Interval,
            cancellationToken));

    private static async Task<IResult> ListGroupMembers(Guid id,
        int? page,
        int? pageSize,
        IGroupRepository groups,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        if (await groups.FindAsync(id, cancellationToken) is null)
        {
            return NotFound("There is no such group.");
        }

        var (p, size) = Paging(page, pageSize);
        return TypedResults.Ok(await admin.ListGroupMembersAsync(id, p, size, cancellationToken));
    }

    private static async Task<IResult> AddGroupMember(Guid id,
        Guid userId,
        IGroupRepository groups,
        IUserRepository users,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var refusal = await CheckMemberEditAsync(id, userId, true, groups, users, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        if (await groups.AddMemberAsync(id, userId, time.GetUtcNow(), cancellationToken))
        {
            audit.Record(AuditActions.GroupMemberAdded, AuditActions.Group, id, new { userId });
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return TypedResults.NoContent();
    }

    private static async Task<IResult> RemoveGroupMember(Guid id,
        Guid userId,
        IGroupRepository groups,
        IUserRepository users,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        CancellationToken cancellationToken)
    {
        var refusal = await CheckMemberEditAsync(id, userId, false, groups, users, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        if (await groups.RemoveMemberAsync(id, userId, cancellationToken))
        {
            audit.Record(AuditActions.GroupMemberRemoved, AuditActions.Group, id, new { userId });
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return TypedResults.NoContent();
    }

    /// <summary>404 for an unknown group or person, 409 for a linked group (the provider owns its members); null when the edit is fine.</summary>
    private static async Task<IResult?> CheckMemberEditAsync(Guid groupId,
        Guid userId,
        bool adding,
        IGroupRepository groups,
        IUserRepository users,
        CancellationToken cancellationToken)
    {
        var group = await groups.FindAsync(groupId, cancellationToken);
        if (group is null)
        {
            return NotFound("There is no such group.");
        }

        if (group.Source != GroupSource.Local)
        {
            return TypedResults.Problem(
                "This group is linked to the identity provider, which owns its members. Change them there, or unlink the group first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var user = await users.FindAsync(userId, cancellationToken);
        if (user is null)
        {
            return NotFound("There is no such person.");
        }

        return user.IsDeactivated && adding
            ? TypedResults.Problem("This person is deactivated.", statusCode: StatusCodes.Status409Conflict)
            : null;
    }

    private static async Task<Ok<PagedResult<AdminRoomDto>>> ListRooms(string? query,
        int? page,
        int? pageSize,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        var (p, size) = Paging(page, pageSize);
        return TypedResults.Ok(await admin.ListRoomsAsync(Query(query), p, size, cancellationToken));
    }

    /// <summary>
    /// The audit log of the instance (#669), newest first: <c>subject</c> (what it is about), <c>actor</c> (who did it), <c>from</c>
    /// (inclusive) and <c>to</c> (exclusive) as dates or date-times. Only ids, roles and counts are in an entry, never content.
    /// </summary>
    private static async Task<Ok<PagedResult<AuditEntryDto>>> ListAudit(Guid? subject,
        Guid? actor,
        DateTimeOffset? from,
        DateTimeOffset? to,
        int? page,
        int? pageSize,
        IAuditRepository audit,
        CancellationToken cancellationToken)
    {
        var (p, size) = Paging(page, pageSize);
        return TypedResults.Ok(await audit.QueryAsync(subject, actor, from, to, p, size, cancellationToken));
    }

    private static ProblemHttpResult NotFound(string detail) =>
        TypedResults.Problem(detail, statusCode: StatusCodes.Status404NotFound);

    private static ValidationProblem NameProblem() =>
        Invalid("name", $"A name is 1 to {Group.MaxNameLength} characters.");

    private static ValidationProblem Invalid(string field, string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
