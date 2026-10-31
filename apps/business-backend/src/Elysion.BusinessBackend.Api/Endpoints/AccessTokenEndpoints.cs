using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Caching.Memory;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Personal access tokens (ADR 0033, #851). A person makes, lists and revokes their own; the secret is in the answer to its creation
/// and nowhere else. Only a person signed in to Elysion manages tokens: a request made with a token or by an integration is
/// <c>403</c>, so a leaked token cannot make itself a successor. Administrators list every token and revoke any.
/// <c>GET /me/credential</c> tells the BFF who a credential is and what it may do.
/// </summary>
public static class AccessTokenEndpoints
{
    public static IEndpointRouteBuilder MapAccessTokenEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/me/credential", Credential).WithName("GetCredential").WithTags("Access tokens");

        var own = routes.MapGroup("/access-tokens").WithTags("Access tokens");
        own.MapGet("", List).WithName("ListAccessTokens");
        own.MapPost("", Create)
            .WithName("CreateAccessToken")
            .Accepts<CreateAccessTokenRequest>("application/json")
            .RequireJsonContentType();
        own.MapDelete("/{id:guid}", Revoke).WithName("RevokeAccessToken");

        var admin = routes.MapGroup("/admin/access-tokens")
            .WithTags("Administration")
            .RequireAuthorization(AdminPolicies.InstanceAdminister);
        admin.MapGet("", AdminList).WithName("AdminListAccessTokens");
        admin.MapDelete("/{id:guid}", AdminRevoke).WithName("AdminRevokeAccessToken");
        return routes;
    }

    private static Ok<CredentialDto> Credential(ICurrentUser caller) =>
        TypedResults.Ok(new CredentialDto(caller.Id,
            caller.DisplayName,
            caller.IsIntegration ? "integration" : "person",
            caller.AccessTokenId,
            caller.Scopes));

    private static async Task<IResult> List(ICurrentUser caller,
        IAccessTokenRepository tokens,
        CancellationToken cancellationToken)
    {
        if (NotAPerson(caller) is { } refusal)
        {
            return refusal;
        }

        var list = await tokens.ListForOwnerAsync(caller.Id, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<AccessTokenDto>>(list.Select(ToDto).ToList());
    }

    private static async Task<IResult> Create(CreateAccessTokenRequest? request,
        ICurrentUser caller,
        IAccessTokenRepository tokens,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (NotAPerson(caller) is { } refusal)
        {
            return refusal;
        }

        var errors = new Dictionary<string, string[]>();
        var name = request?.Name?.Trim() ?? "";
        if (name.Length is 0 or > AccessToken.MaxNameLength)
        {
            errors["name"] = [$"A name is 1 to {AccessToken.MaxNameLength} characters."];
        }

        var scopes = request?.Scopes ?? [];
        if (scopes.Count == 0 || scopes.Any(s => s is null || !AccessTokenScopes.IsKnown(s)))
        {
            errors["scopes"] = [$"Choose one or more of: {string.Join(", ", AccessTokenScopes.All)}."];
        }

        if (request?.ExpiresInDays is not (>= 1 and <= AccessToken.MaxLifetimeDays))
        {
            errors["expiresInDays"] = [$"A token expires after 1 to {AccessToken.MaxLifetimeDays} days."];
        }

        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var now = time.GetUtcNow();
        if (await tokens.CountActiveAsync(caller.Id, now, cancellationToken) >= AccessToken.MaxActivePerOwner)
        {
            return TypedResults.Problem(
                $"You have {AccessToken.MaxActivePerOwner} active tokens. Revoke one you no longer use first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var secret = AccessTokenSecrets.Generate();
        var token = AccessToken.Create(Guid.CreateVersion7(),
            caller.Id,
            name,
            AccessTokenSecrets.DisplayPrefix(secret),
            AccessTokenSecrets.Hash(secret),
            scopes.ToList(),
            now,
            now.AddDays(request!.ExpiresInDays!.Value));
        tokens.Add(token);
        audit.Record(AuditActions.TokenCreated,
            AuditActions.User,
            caller.Id,
            new { tokenId = token.Id, name = token.Name, scopes = token.ScopeList, expiresAt = token.ExpiresAt });
        await unitOfWork.SaveChangesAsync(cancellationToken);

        var dto = ToDto(token);
        return TypedResults.Created($"/access-tokens/{token.Id}",
            new CreatedAccessTokenDto(dto.Id,
                dto.Name,
                dto.Prefix,
                dto.Scopes,
                dto.CreatedAt,
                dto.LastUsedAt,
                dto.ExpiresAt,
                secret));
    }

    /// <summary>Revokes one of the caller's tokens: <c>204</c>, also when it was revoked already; <c>404</c> for anybody else's.</summary>
    private static async Task<IResult> Revoke(Guid id,
        ICurrentUser caller,
        IAccessTokenRepository tokens,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        IMemoryCache cache,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (NotAPerson(caller) is { } refusal)
        {
            return refusal;
        }

        var token = await tokens.FindForUpdateAsync(id, cancellationToken);
        if (token is null || token.OwnerId != caller.Id)
        {
            return TypedResults.Problem("There is no such token.", statusCode: StatusCodes.Status404NotFound);
        }

        await RevokeAsync(token, audit, unitOfWork, cache, time, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> AdminList(string? query,
        int? page,
        int? pageSize,
        IAccessTokenRepository tokens,
        CancellationToken cancellationToken)
    {
        var text = query?.Trim();
        if (text is { Length: > Admin.AdminEndpoints.MaxQueryLength })
        {
            text = text[..Admin.AdminEndpoints.MaxQueryLength];
        }

        var p = page is > 0 ? page.Value : 1;
        var size = pageSize is > 0
            ? Math.Min(pageSize.Value, Admin.AdminEndpoints.MaxPageSize)
            : Admin.AdminEndpoints.DefaultPageSize;
        return TypedResults.Ok(await tokens.ListAllAsync(text, p, size, cancellationToken));
    }

    private static async Task<IResult> AdminRevoke(Guid id,
        IAccessTokenRepository tokens,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        IMemoryCache cache,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var token = await tokens.FindForUpdateAsync(id, cancellationToken);
        if (token is null)
        {
            return TypedResults.Problem("There is no such token.", statusCode: StatusCodes.Status404NotFound);
        }

        await RevokeAsync(token, audit, unitOfWork, cache, time, cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>Revokes a token once (a second revoke writes nothing) and forgets this instance's lookup of it at once.</summary>
    private static async Task RevokeAsync(AccessToken token,
        IAuditLog audit,
        IUnitOfWork unitOfWork,
        IMemoryCache cache,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        if (token.RevokedAt is null)
        {
            token.RevokedAt = time.GetUtcNow();
            audit.Record(AuditActions.TokenRevoked,
                AuditActions.User,
                token.OwnerId,
                new { tokenId = token.Id, name = token.Name });
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        cache.Remove(AccessTokenAuthenticationHandler.CacheKey(token.Hash));
    }

    /// <summary>A token or an integration cannot manage tokens: only a person signed in to Elysion can.</summary>
    private static ProblemHttpResult? NotAPerson(ICurrentUser caller) =>
        caller.AccessTokenId is null && !caller.IsIntegration
            ? null
            : TypedResults.Problem("Access tokens are managed by a person signed in to Elysion, not with a token.",
                statusCode: StatusCodes.Status403Forbidden);

    private static AccessTokenDto ToDto(AccessToken token) =>
        new(token.Id,
            token.Name,
            token.Prefix,
            token.ScopeList,
            token.CreatedAt,
            token.LastUsedAt,
            token.ExpiresAt);
}
