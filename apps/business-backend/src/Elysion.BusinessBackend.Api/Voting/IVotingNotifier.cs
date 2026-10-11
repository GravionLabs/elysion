using Elysion.BusinessBackend.Api.Contracts;

namespace Elysion.BusinessBackend.Api.Voting;

/// <summary>The kinds of change the realtime service is told about (ADR 0029).</summary>
public static class VotingEvents
{
    public const string Start = "start";
    public const string Vote = "vote";
    public const string Retract = "retract";
    public const string Close = "close";
    public const string Clear = "clear";
}

/// <summary>
/// Tells the realtime service that a voting changed, so it can pass the news to everybody on the board (ADR 0029).
/// Best effort: a failure is logged and never fails the request, because a client fetches the voting again when it connects.
/// </summary>
public interface IVotingNotifier
{
    /// <param name="boardId">The board the voting belongs to.</param>
    /// <param name="votingEvent">One of <see cref="VotingEvents"/>.</param>
    /// <param name="voting">What everybody may see of the voting now, or null when the board has none (after a clear).</param>
    Task NotifyAsync(Guid boardId, string votingEvent, VotingBroadcastDto? voting, CancellationToken cancellationToken);
}
