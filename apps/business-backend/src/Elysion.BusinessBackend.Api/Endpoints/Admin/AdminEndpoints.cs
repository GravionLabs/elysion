using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

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

    private static async Task<Ok<PagedResult<AdminUserDto>>> ListUsers(string? query,
        int? page,
        int? pageSize,
        IAdminRepository admin,
        CancellationToken cancellationToken)
    {
        var (p, size) = Paging(page, pageSize);
        return TypedResults.Ok(await admin.ListUsersAsync(Query(query), p, size, cancellationToken));
    }

    private static async Task<IResult> GetUser(Guid id, IAdminRepository admin, CancellationToken cancellationToken)
    {
        var user = await admin.GetUserAsync(id, cancellationToken);
        return user is null ? NotFound("There is no such person.") : TypedResults.Ok(user);
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
        var refusal = await CheckMemberEditAsync(id, userId, groups, users, cancellationToken);
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
        var refusal = await CheckMemberEditAsync(id, userId, groups, users, cancellationToken);
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

        return await users.FindAsync(userId, cancellationToken) is null ? NotFound("There is no such person.") : null;
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
