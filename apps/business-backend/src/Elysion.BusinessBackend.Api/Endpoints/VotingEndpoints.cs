using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Voting;

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Endpoints;

/// <summary>
/// Dot voting on the server (#732, ADR 0029). Everybody with a role on the board votes (the read policy, viewers included);
/// starting, closing and clearing need the write policy. The response shows the caller their own votes and, while the voting
/// is open, nobody else's targets. After each change the realtime service is told, with what everybody may see.
/// </summary>
public static class VotingEndpoints
{
    public static IEndpointRouteBuilder MapVotingEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/boards/{id:guid}").WithTags("Votings");

        group.MapGet("/voting", Current).WithName("GetVoting").RequireAuthorization(BoardPolicies.Read);
        group.MapPost("/votings", Start)
            .WithName("StartVoting")
            .Accepts<StartVotingRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(BoardPolicies.Write);
        group.MapDelete("/votings", Clear).WithName("ClearVotings").RequireAuthorization(BoardPolicies.Write);
        group.MapPost("/votings/{votingId:guid}/votes", Cast)
            .WithName("CastVote")
            .Accepts<CastVoteRequest>("application/json")
            .RequireJsonContentType()
            .RequireAuthorization(BoardPolicies.Read);
        group.MapDelete("/votings/{votingId:guid}/votes/{elementId}", Retract)
            .WithName("RetractVote")
            .RequireAuthorization(BoardPolicies.Read);
        group.MapPost("/votings/{votingId:guid}/close", Close)
            .WithName("CloseVoting")
            .RequireAuthorization(BoardPolicies.Write);
        return routes;
    }

    private static async Task<Results<Ok<VotingDto>, NoContent>> Current(Guid id,
        IVotingRepository votings,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var current = await votings.GetCurrentAsync(id, cancellationToken);
        return current is null ? TypedResults.NoContent() : TypedResults.Ok(VotingViews.For(current, user.Id));
    }

    private static async Task<IResult> Start(Guid id,
        StartVotingRequest? request,
        IVotingRepository votings,
        IUnitOfWork unitOfWork,
        IVotingNotifier notifier,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        var name = (request?.Name ?? "").Trim();
        if (name.Length > VotingSession.MaxNameLength)
        {
            errors["name"] = [$"The name can have up to {VotingSession.MaxNameLength} characters."];
        }

        if (request?.VotesPerPerson is not (>= 1 and <= VotingSession.MaxVotesPerPerson))
        {
            errors["votesPerPerson"] =
                [$"The votes per person must be a whole number from 1 to {VotingSession.MaxVotesPerPerson}."];
        }

        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (await votings.HasOpenAsync(id, cancellationToken))
        {
            return AlreadyOpen();
        }

        var now = time.GetUtcNow();
        var session = new VotingSession
        {
            Id = Guid.NewGuid(),
            BoardId = id,
            Name = name.Length == 0 ? VotingSession.DefaultName : name,
            VotesPerPerson = request!.VotesPerPerson!.Value,
            Status = VotingStatus.Open,
            Named = request.Named == true,
            StartedBySubject = user.Subject,
            StartedByName = user.DisplayName,
            StartedAt = Truncate(now),
        };
        votings.Add(session);
        try
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two starts raced: the unique index of open votings let only one through.
            return AlreadyOpen();
        }

        await notifier.NotifyAsync(id, VotingEvents.Start, VotingViews.Broadcast(session), cancellationToken);
        return TypedResults.Created($"/boards/{id}/voting", VotingViews.For(session, user.Id));
    }

    private static async Task<IResult> Cast(Guid id,
        Guid votingId,
        CastVoteRequest? request,
        IVotingRepository votings,
        IUnitOfWork unitOfWork,
        IVotingNotifier notifier,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var elementId = request?.ElementId?.Trim() ?? "";
        if (elementId.Length is 0 or > VotingSession.MaxElementIdLength)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["elementId"] =
                    [$"The element id must be between 1 and {VotingSession.MaxElementIdLength} characters."],
            });
        }

        var session = await votings.FindAsync(id, votingId, cancellationToken);
        if (session is null)
        {
            return TypedResults.NotFound();
        }

        if (session.Status != VotingStatus.Open)
        {
            return Closed();
        }

        if (session.Votes.Count(v => v.UserId == user.Id) >= session.VotesPerPerson)
        {
            return TypedResults.Problem(
                $"You have placed all {session.VotesPerPerson} of your votes. Take one back to vote elsewhere.",
                statusCode: StatusCodes.Status409Conflict,
                title: "No votes left");
        }

        var vote = new Vote
        {
            Id = Guid.NewGuid(),
            VotingSessionId = session.Id,
            UserId = user.Id,
            ElementId = elementId,
            CreatedAt = Truncate(time.GetUtcNow()),
            User = null,
        };
        votings.AddVote(vote);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        // Read back with the voters' names so that the answer and the news are built from the same rows.
        var after = await votings.FindAsync(id, votingId, cancellationToken);
        await notifier.NotifyAsync(id, VotingEvents.Vote, VotingViews.Broadcast(after!), cancellationToken);
        return TypedResults.Ok(VotingViews.For(after!, user.Id));
    }

    private static async Task<IResult> Retract(Guid id,
        Guid votingId,
        string elementId,
        IVotingRepository votings,
        IUnitOfWork unitOfWork,
        IVotingNotifier notifier,
        ICurrentUser user,
        CancellationToken cancellationToken)
    {
        var session = await votings.FindAsync(id, votingId, cancellationToken);
        if (session is null)
        {
            return TypedResults.NotFound();
        }

        if (session.Status != VotingStatus.Open)
        {
            return Closed();
        }

        var mine = session.Votes.Where(v => v.UserId == user.Id && v.ElementId == elementId)
            .OrderByDescending(v => v.CreatedAt)
            .FirstOrDefault();
        if (mine is null)
        {
            return TypedResults.NoContent();
        }

        votings.RemoveVote(mine);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        session.Votes.Remove(mine);
        await notifier.NotifyAsync(id, VotingEvents.Retract, VotingViews.Broadcast(session), cancellationToken);
        return TypedResults.Ok(VotingViews.For(session, user.Id));
    }

    private static async Task<IResult> Close(Guid id,
        Guid votingId,
        IVotingRepository votings,
        IUnitOfWork unitOfWork,
        IVotingNotifier notifier,
        ICurrentUser user,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var session = await votings.FindAsync(id, votingId, cancellationToken);
        if (session is null)
        {
            return TypedResults.NotFound();
        }

        // Closing a closed voting is not an error (two clients may end it at the same moment), and tells nobody anything new.
        if (session.Status == VotingStatus.Open)
        {
            session.Status = VotingStatus.Closed;
            session.ClosedAt = Truncate(time.GetUtcNow());
            await unitOfWork.SaveChangesAsync(cancellationToken);
            await notifier.NotifyAsync(id, VotingEvents.Close, VotingViews.Broadcast(session), cancellationToken);
        }

        return TypedResults.Ok(VotingViews.For(session, user.Id));
    }

    private static async Task<NoContent> Clear(Guid id,
        IVotingRepository votings,
        IUnitOfWork unitOfWork,
        IVotingNotifier notifier,
        CancellationToken cancellationToken)
    {
        await votings.ClearClosedAsync(id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        var current = await votings.GetCurrentAsync(id, cancellationToken);
        await notifier.NotifyAsync(id,
            VotingEvents.Clear,
            current is null ? null : VotingViews.Broadcast(current),
            cancellationToken);
        return TypedResults.NoContent();
    }

    private static ProblemHttpResult AlreadyOpen() =>
        TypedResults.Problem("A voting is already open on this board. Close it before starting another.",
            statusCode: StatusCodes.Status409Conflict,
            title: "Voting already open");

    private static ProblemHttpResult Closed() =>
        TypedResults.Problem("This voting is closed.",
            statusCode: StatusCodes.Status409Conflict,
            title: "Voting closed");

    // Postgres keeps microseconds; the response to a change must show what a later read shows.
    private static DateTimeOffset Truncate(DateTimeOffset value) => new(value.Ticks - value.Ticks % 10, value.Offset);
}
