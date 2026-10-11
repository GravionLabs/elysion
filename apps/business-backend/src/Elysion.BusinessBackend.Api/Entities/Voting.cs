namespace Elysion.BusinessBackend.Api.Entities;

public enum VotingStatus
{
    // Stored as numbers: the unique index of open sessions filters on Open = 0.
    Open = 0,
    Closed = 1,
}

/// <summary>
/// A dot voting of a board (#732, ADR 0029). At most one is open per board; the closed ones stay (with their votes) until
/// somebody clears the results. It goes with the board.
/// </summary>
public class VotingSession
{
    public const int MaxNameLength = 80;
    public const int MaxVotesPerPerson = 100;
    public const int MaxElementIdLength = 128;
    public const string DefaultName = "Voting";

    public Guid Id { get; set; }
    public Guid BoardId { get; set; }
    public required string Name { get; set; }
    public int VotesPerPerson { get; set; }
    public VotingStatus Status { get; set; }

    /// <summary>Whether the closed result names who voted for what (the facilitator's choice at the start).</summary>
    public bool Named { get; set; }

    /// <summary>The starter as the identity provider and the canvas know them (the token's subject), with the name at that time.</summary>
    public required string StartedBySubject { get; set; }

    public required string StartedByName { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }

    public Board? Board { get; set; }
    public List<Vote> Votes { get; set; } = [];
}

/// <summary>One dot of one person on one element. An element may carry several of the same person's dots.</summary>
public class Vote
{
    public Guid Id { get; set; }
    public Guid VotingSessionId { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The id of the Excalidraw element on the board.</summary>
    public required string ElementId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public VotingSession? VotingSession { get; set; }
    public User? User { get; set; }
}
