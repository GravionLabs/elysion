using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Webhooks;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Webhooks (ADR 0033, #853): the owners of a board register endpoints for its events (<c>/boards/{id}/webhooks</c>, the administer
/// policy), administrators for the events of every board (<c>/admin/webhooks</c>). The secret is in the answer to the creation and
/// nowhere else. Each endpoint lists its last <see cref="WebhookDeliveryService.KeptPerEndpoint"/> deliveries, can send a test event
/// and send a delivery again. Sending is the worker's job: these answer at once.
/// </summary>
public static class WebhookEndpoints
{
    public static IEndpointRouteBuilder MapWebhookEndpoints(this IEndpointRouteBuilder routes)
    {
        var board = routes.MapGroup("/boards/{id:guid}/webhooks")
            .WithTags("Webhooks")
            .RequireAuthorization(BoardPolicies.Administer);
        board.MapGet("", (Guid id, IWebhookRepository webhooks, CancellationToken ct) => ListAsync(id, webhooks, ct))
            .WithName("ListBoardWebhooks");
        board.MapPost("",
                (Guid id, CreateWebhookRequest? request, [AsParameters] Services services, CancellationToken ct) =>
                    CreateAsync(id, request, services, ct))
            .WithName("CreateBoardWebhook")
            .Accepts<CreateWebhookRequest>("application/json")
            .RequireJsonContentType();
        MapEndpoint(board, "Board");

        var admin = routes.MapGroup("/admin/webhooks")
            .WithTags("Administration")
            .RequireAuthorization(AdminPolicies.InstanceAdminister);
        admin.MapGet("", (IWebhookRepository webhooks, CancellationToken ct) => ListAsync(null, webhooks, ct))
            .WithName("AdminListWebhooks");
        admin.MapPost("",
                (CreateWebhookRequest? request, [AsParameters] Services services, CancellationToken ct) =>
                    CreateAsync(null, request, services, ct))
            .WithName("AdminCreateWebhook")
            .Accepts<CreateWebhookRequest>("application/json")
            .RequireJsonContentType();
        MapEndpoint(admin, "Admin");
        return routes;
    }

    /// <summary>
    /// The routes of one endpoint, under a board's group (the route's <c>id</c> is the board) or the admin's (no <c>id</c>: an
    /// instance-wide endpoint). An endpoint is only found where it belongs, so a board's owner never reaches another board's.
    /// </summary>
    private static void MapEndpoint(RouteGroupBuilder group, string name)
    {
        group.MapGet("/{webhookId:guid}",
                (HttpContext http, Guid webhookId, IWebhookRepository webhooks, CancellationToken ct) =>
                    GetAsync(BoardOf(http), webhookId, webhooks, ct))
            .WithName($"{name}GetWebhook");
        group.MapPatch("/{webhookId:guid}",
                (HttpContext http,
                        Guid webhookId,
                        UpdateWebhookRequest? request,
                        [AsParameters] Services services,
                        CancellationToken ct) =>
                    UpdateAsync(BoardOf(http), webhookId, request, services, ct))
            .WithName($"{name}UpdateWebhook")
            .Accepts<UpdateWebhookRequest>("application/json")
            .RequireJsonContentType();
        group.MapDelete("/{webhookId:guid}",
                (HttpContext http, Guid webhookId, [AsParameters] Services services, CancellationToken ct) =>
                    DeleteAsync(BoardOf(http), webhookId, services, ct))
            .WithName($"{name}DeleteWebhook");
        group.MapPost("/{webhookId:guid}/test",
                (HttpContext http, Guid webhookId, [AsParameters] Services services, CancellationToken ct) =>
                    TestAsync(BoardOf(http), webhookId, services, ct))
            .WithName($"{name}TestWebhook");
        group.MapGet("/{webhookId:guid}/deliveries",
                (HttpContext http, Guid webhookId, IWebhookRepository webhooks, CancellationToken ct) =>
                    DeliveriesAsync(BoardOf(http), webhookId, webhooks, ct))
            .WithName($"{name}ListWebhookDeliveries");
        group.MapPost("/{webhookId:guid}/deliveries/{deliveryId:guid}/redeliver",
                (HttpContext http,
                        Guid webhookId,
                        Guid deliveryId,
                        [AsParameters] Services services,
                        CancellationToken ct) =>
                    RedeliverAsync(BoardOf(http), webhookId, deliveryId, services, ct))
            .WithName($"{name}RedeliverWebhook");
    }

    /// <summary>The board of the route, or null on the admin's routes.</summary>
    private static Guid? BoardOf(HttpContext http) =>
        http.GetRouteValue("id") is string text && Guid.TryParse(text, out var id) ? id : null;

    /// <summary>What the changing handlers need, as one parameter.</summary>
    internal sealed record Services(
        IWebhookRepository Webhooks,
        IWebhookEvents Events,
        IAuditLog Audit,
        IUnitOfWork UnitOfWork,
        ICurrentUser User,
        IOptions<WebhookOptions> Options,
        TimeProvider Time);

    private static async Task<Ok<IReadOnlyList<WebhookDto>>> ListAsync(Guid? boardId,
        IWebhookRepository webhooks,
        CancellationToken cancellationToken)
    {
        var list = await webhooks.ListAsync(boardId, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<WebhookDto>>(list.Select(ToDto).ToList());
    }

    private static async Task<IResult> GetAsync(Guid? boardId,
        Guid webhookId,
        IWebhookRepository webhooks,
        CancellationToken cancellationToken)
    {
        var endpoint = await webhooks.FindForUpdateAsync(boardId, webhookId, cancellationToken);
        return endpoint is null ? NoSuchWebhook() : TypedResults.Ok(ToDto(endpoint));
    }

    private static async Task<IResult> CreateAsync(Guid? boardId,
        CreateWebhookRequest? request,
        Services services,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (!WebhookUrl.TryValidate(request?.Url, services.Options.Value, out var url, out var urlError))
        {
            errors["url"] = [urlError];
        }

        if (!TryEvents(request?.Events, out var events))
        {
            errors["events"] = [EventsMessage];
        }

        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (await services.Webhooks.CountAsync(boardId, cancellationToken) >= WebhookEndpoint.MaxPerBoard)
        {
            return TypedResults.Problem(
                $"There are {WebhookEndpoint.MaxPerBoard} webhooks here already, the most there may be. Delete one first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var secret = WebhookSecrets.Generate();
        var endpoint = WebhookEndpoint.Create(Guid.CreateVersion7(),
            boardId,
            url,
            events,
            secret,
            services.User.Id,
            services.Time.GetUtcNow());
        services.Webhooks.Add(endpoint);
        services.Audit.Record(AuditActions.WebhookCreated,
            AuditActions.Board,
            boardId,
            new { webhookId = endpoint.Id, host = WebhookUrl.HostOf(url) });
        await services.UnitOfWork.SaveChangesAsync(cancellationToken);

        var dto = ToDto(endpoint);
        var location = boardId is null ? $"/admin/webhooks/{endpoint.Id}" : $"/boards/{boardId}/webhooks/{endpoint.Id}";
        return TypedResults.Created(location,
            new CreatedWebhookDto(dto.Id,
                dto.BoardId,
                dto.Url,
                dto.Events,
                dto.Enabled,
                dto.DisabledAt,
                dto.DisabledReason,
                dto.CreatedAt,
                dto.SecretPrefix,
                secret));
    }

    private static async Task<IResult> UpdateAsync(Guid? boardId,
        Guid webhookId,
        UpdateWebhookRequest? request,
        Services services,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        var url = "";
        if (request?.Url is not null
            && !WebhookUrl.TryValidate(request.Url, services.Options.Value, out url, out var urlError))
        {
            errors["url"] = [urlError];
        }

        IReadOnlyList<string> events = [];
        if (request?.Events is not null && !TryEvents(request.Events, out events))
        {
            errors["events"] = [EventsMessage];
        }

        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var endpoint = await services.Webhooks.FindForUpdateAsync(boardId, webhookId, cancellationToken);
        if (endpoint is null)
        {
            return NoSuchWebhook();
        }

        if (request?.Url is not null)
        {
            endpoint.Url = url;
        }

        if (request?.Events is not null)
        {
            endpoint.Events = WebhookEventTypes.Format(events);
        }

        switch (request?.Enabled)
        {
            case true:
                endpoint.DisabledAt = null;
                endpoint.DisabledReason = null;
                endpoint.FailingSince = null;
                break;
            case false when endpoint.DisabledAt is null:
                endpoint.DisabledAt = services.Time.GetUtcNow();
                endpoint.DisabledReason = "Switched off by a person.";
                break;
        }

        await services.UnitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(ToDto(endpoint));
    }

    private static async Task<IResult> DeleteAsync(Guid? boardId,
        Guid webhookId,
        Services services,
        CancellationToken cancellationToken)
    {
        var endpoint = await services.Webhooks.FindForUpdateAsync(boardId, webhookId, cancellationToken);
        if (endpoint is null)
        {
            return NoSuchWebhook();
        }

        services.Webhooks.Remove(endpoint);
        services.Audit.Record(AuditActions.WebhookDeleted,
            AuditActions.Board,
            boardId,
            new { webhookId = endpoint.Id, host = WebhookUrl.HostOf(endpoint.Url) });
        await services.UnitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>"Send test event": a <c>webhook.test</c> for this endpoint only, also when it is switched off (it then waits).</summary>
    private static async Task<IResult> TestAsync(Guid? boardId,
        Guid webhookId,
        Services services,
        CancellationToken cancellationToken)
    {
        var endpoint = await services.Webhooks.FindForUpdateAsync(boardId, webhookId, cancellationToken);
        if (endpoint is null)
        {
            return NoSuchWebhook();
        }

        var delivery = services.Events.StageTest(endpoint);
        await services.UnitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Accepted((string?)null, ToDto(delivery));
    }

    private static async Task<IResult> DeliveriesAsync(Guid? boardId,
        Guid webhookId,
        IWebhookRepository webhooks,
        CancellationToken cancellationToken)
    {
        if (await webhooks.FindForUpdateAsync(boardId, webhookId, cancellationToken) is null)
        {
            return NoSuchWebhook();
        }

        var list = await webhooks.ListDeliveriesAsync(webhookId,
            WebhookDeliveryService.KeptPerEndpoint,
            cancellationToken);
        return TypedResults.Ok<IReadOnlyList<WebhookDeliveryDto>>(list.Select(ToDto).ToList());
    }

    private static async Task<IResult> RedeliverAsync(Guid? boardId,
        Guid webhookId,
        Guid deliveryId,
        Services services,
        CancellationToken cancellationToken)
    {
        if (await services.Webhooks.FindForUpdateAsync(boardId, webhookId, cancellationToken) is null)
        {
            return NoSuchWebhook();
        }

        var delivery = await services.Webhooks.FindDeliveryAsync(webhookId, deliveryId, cancellationToken);
        if (delivery is null)
        {
            return TypedResults.Problem("There is no such delivery.", statusCode: StatusCodes.Status404NotFound);
        }

        if (delivery.Status == WebhookDeliveryStatus.Pending)
        {
            return TypedResults.Problem("This delivery is still being sent.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var again = services.Events.StageRedelivery(delivery);
        await services.UnitOfWork.SaveChangesAsync(cancellationToken);
        return TypedResults.Accepted((string?)null, ToDto(again));
    }

    private const string EventsMessage = "Choose none (all events) or some of the known events.";

    private static bool TryEvents(IReadOnlyList<string>? given, out IReadOnlyList<string> events)
    {
        events = given ?? [];
        return events.Count <= WebhookEventTypes.All.Count * 2
               && events.All(e => e is not null && WebhookEventTypes.IsKnown(e));
    }

    private static ProblemHttpResult NoSuchWebhook() =>
        TypedResults.Problem("There is no such webhook.", statusCode: StatusCodes.Status404NotFound);

    internal static WebhookDto ToDto(WebhookEndpoint endpoint) =>
        new(endpoint.Id,
            endpoint.BoardId,
            endpoint.Url,
            endpoint.EventList,
            endpoint.DisabledAt is null,
            endpoint.DisabledAt,
            endpoint.DisabledReason,
            endpoint.CreatedAt,
            WebhookSecrets.DisplayPrefix(endpoint.Secret));

    internal static WebhookDeliveryDto ToDto(WebhookDelivery delivery) =>
        new(delivery.Id,
            delivery.EventId,
            delivery.EventType,
            delivery.Status.ToString().ToLowerInvariant(),
            delivery.Attempts,
            delivery.ResponseStatus,
            delivery.DurationMs,
            delivery.Error,
            delivery.CreatedAt,
            delivery.LastAttemptAt,
            delivery.Status == WebhookDeliveryStatus.Pending ? delivery.NextAttemptAt : null);
}
