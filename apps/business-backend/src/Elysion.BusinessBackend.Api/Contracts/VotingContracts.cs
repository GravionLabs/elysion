using System.Text.Json.Serialization;

using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Contracts;

/// <summary>Body of <c>POST /boards/{id}/votings</c>. Blank name is "Voting"; the votes per person are required.</summary>
public sealed record StartVotingRequest(string? Name, int? VotesPerPerson, bool? Named);

/// <summary>Body of <c>POST /boards/{id}/votings/{votingId}/votes</c>.</summary>
public sealed record CastVoteRequest(string? ElementId);

public sealed record VotingPersonDto(string Id, string Name);

/// <summary>The votes of one element in a closed voting; <c>Voters</c> only when the voting was named.</summary>
public sealed record VotingResultDto(
    string ElementId,
    int Count,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<VotingPersonDto>? Voters);

/// <summary>
/// The fields of a voting that everybody on the board may see. While it is open that is its state and, in
/// <c>Placed</c>, how many votes each person has placed (not on what); once closed it is the result.
/// <c>Id</c> of a person is the identity-provider subject, the id the canvas knows.
/// </summary>
public record VotingBroadcastDto(
    Guid Id,
    string Name,
    int VotesPerPerson,
    string Status,
    bool Named,
    VotingPersonDto StartedBy,
    DateTimeOffset StartedAt,
    DateTimeOffset? ClosedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyDictionary<string, int>? Placed,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<VotingResultDto>? Result);

/// <summary>A voting as one caller sees it: the broadcast fields plus their own votes, and only theirs.</summary>
public sealed record VotingDto(
    Guid Id,
    string Name,
    int VotesPerPerson,
    string Status,
    bool Named,
    VotingPersonDto StartedBy,
    DateTimeOffset StartedAt,
    DateTimeOffset? ClosedAt,
    IReadOnlyDictionary<string, int>? Placed,
    IReadOnlyList<VotingResultDto>? Result,
    int MyVotes,
    IReadOnlyDictionary<string, int> MyElementVotes)
    : VotingBroadcastDto(Id, Name, VotesPerPerson, Status, Named, StartedBy, StartedAt, ClosedAt, Placed, Result);

public static class VotingViews
{
    public static string StatusName(VotingStatus status) => status == VotingStatus.Open ? "open" : "closed";

    /// <summary>What may be told to everybody. The votes must be loaded with their <see cref="Vote.User"/>.</summary>
    public static VotingBroadcastDto Broadcast(VotingSession session)
    {
        var open = session.Status == VotingStatus.Open;
        return new VotingBroadcastDto(
            session.Id,
            session.Name,
            session.VotesPerPerson,
            StatusName(session.Status),
            session.Named,
            new VotingPersonDto(session.StartedBySubject, session.StartedByName),
            session.StartedAt,
            session.ClosedAt,
            open ? PlacedBy(session) : null,
            open ? null : ResultOf(session));
    }

    /// <summary>What <paramref name="caller"/> may see: the broadcast and their own votes.</summary>
    public static VotingDto For(VotingSession session, Guid caller)
    {
        var broadcast = Broadcast(session);
        var mine = session.Votes.Where(v => v.UserId == caller)
            .GroupBy(v => v.ElementId)
            .ToDictionary(g => g.Key, g => g.Count());
        return new VotingDto(broadcast.Id,
            broadcast.Name,
            broadcast.VotesPerPerson,
            broadcast.Status,
            broadcast.Named,
            broadcast.StartedBy,
            broadcast.StartedAt,
            broadcast.ClosedAt,
            broadcast.Placed,
            broadcast.Result,
            mine.Values.Sum(),
            mine);
    }

    private static Dictionary<string, int> PlacedBy(VotingSession session) =>
        session.Votes.GroupBy(v => v.User!.Subject).ToDictionary(g => g.Key, g => g.Count());

    private static List<VotingResultDto> ResultOf(VotingSession session) =>
        session.Votes
            .GroupBy(v => v.ElementId)
            .Select(g => new VotingResultDto(g.Key,
                g.Count(),
                session.Named
                    ? g.GroupBy(v => v.User!.Subject)
                        .Select(p => new VotingPersonDto(p.Key, p.First().User!.DisplayName))
                        .OrderBy(p => p.Name, StringComparer.Ordinal)
                        .ThenBy(p => p.Id, StringComparer.Ordinal)
                        .ToList()
                    : null))
            .OrderByDescending(r => r.Count)
            .ThenBy(r => r.ElementId, StringComparer.Ordinal)
            .ToList();
}
