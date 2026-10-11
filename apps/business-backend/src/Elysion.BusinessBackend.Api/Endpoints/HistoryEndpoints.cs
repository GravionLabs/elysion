using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data.Repositories;

using Microsoft.AspNetCore.Http.HttpResults;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// The history of one board or room for the people who administer it (#669): the last entries of the audit log about it, newest
/// first, so an Owner can see who got access and who lost it. The same policies as the member lists.
/// </summary>
public static class HistoryEndpoints
{
    public const int Entries = 20;

    public static IEndpointRouteBuilder MapHistoryEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/boards/{id:guid}/history",
                (Guid id, IAuditRepository audit, CancellationToken ct) => List(AuditActions.Board, id, audit, ct))
            .WithName("BoardHistory")
            .WithTags("Boards")
            .RequireAuthorization(BoardPolicies.Administer);
        routes.MapGet("/rooms/{id:guid}/history",
                (Guid id, IAuditRepository audit, CancellationToken ct) => List(AuditActions.Room, id, audit, ct))
            .WithName("RoomHistory")
            .WithTags("Rooms")
            .RequireAuthorization(RoomPolicies.Administer);
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<AuditEntryDto>>> List(string type,
        Guid id,
        IAuditRepository audit,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await audit.ListForSubjectAsync(type, id, Entries, cancellationToken));
}
