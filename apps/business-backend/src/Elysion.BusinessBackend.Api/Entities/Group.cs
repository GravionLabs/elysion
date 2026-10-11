using Ardalis.GuardClauses;

namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>
/// A set of people that can be given a role on a room (ADR 0027). A <see cref="GroupSource.Local"/> group is made and kept
/// in Elysion; a <see cref="GroupSource.IdentityProvider"/> ("linked") group is identified by <see cref="ExternalId"/>, the value
/// the provider puts into the <c>groups</c> claim (for Microsoft Entra ID an object id), and its members come only from the tokens.
/// </summary>
public class Group
{
    public const int MaxNameLength = 120;
    public const int MaxExternalIdLength = 255;

    public Guid Id { get; set; }
    public required string Name { get; set; }

    /// <summary>The claim value of a linked group, unique where set; null for a local group.</summary>
    public string? ExternalId { get; set; }

    public GroupSource Source { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// Whether the name was taken from the identity provider's directory (Microsoft Graph, #667) rather than given by an administrator: the sync
    /// may then follow a rename in the directory. A group that is still named after its external id counts as unnamed and is named by the
    /// sync as well; an administrator's rename clears the flag for good.
    /// </summary>
    public bool NameFromProvider { get; set; }

    /// <summary>When the Graph sync last read this group completely, or null when it never did (the sync is off or the group failed).</summary>
    public DateTimeOffset? GraphSyncedAt { get; set; }

    public List<GroupMembership> Memberships { get; set; } = [];

    /// <summary>A local group with a valid name.</summary>
    public static Group Create(Guid id, string name, DateTimeOffset createdAt)
    {
        Guard.Against.Default(id);
        Guard.Against.InvalidInput(name, nameof(name), candidate => TryNormalizeName(candidate, out _));

        _ = TryNormalizeName(name, out var normalized);
        return new Group { Id = id, Name = normalized, Source = GroupSource.Local, CreatedAt = createdAt };
    }

    /// <summary>
    /// A group owned by the identity provider. The name is what an administrator calls it; a group seen in a token for the
    /// first time is named after its external id (the token has no name) until somebody renames it.
    /// </summary>
    public static Group Linked(Guid id, string externalId, string name, DateTimeOffset createdAt)
    {
        Guard.Against.Default(id);
        Guard.Against.InvalidInput(externalId,
            nameof(externalId),
            candidate => !string.IsNullOrWhiteSpace(candidate) && candidate.Trim().Length <= MaxExternalIdLength);
        var cut = name?.Trim() ?? string.Empty;
        // A claim value is longer than a name may be: the name is the value, cut to fit.
        if (cut.Length > MaxNameLength)
        {
            cut = cut[..MaxNameLength];
        }

        Guard.Against.InvalidInput(cut, nameof(name), candidate => TryNormalizeName(candidate, out _));
        return new Group
        {
            Id = id,
            Name = cut,
            ExternalId = externalId.Trim(),
            Source = GroupSource.IdentityProvider,
            CreatedAt = createdAt
        };
    }

    /// <summary>Renames the group (both sources may be renamed: a linked group has only its external id until somebody names it).</summary>
    public void Rename(string name)
    {
        Guard.Against.InvalidInput(name, nameof(name), candidate => TryNormalizeName(candidate, out _));
        _ = TryNormalizeName(name, out var normalized);
        Name = normalized;
        NameFromProvider = false;
    }

    /// <summary>
    /// The name the directory gives the group (#667), unless an administrator named it: a group the sync named stays under its
    /// control, one that was renamed by hand does not. Returns whether the name changed.
    /// </summary>
    public bool NameFromDirectory(string? directoryName)
    {
        if (!TryNormalizeName(directoryName, out var normalized) || normalized.Length > MaxNameLength)
        {
            return false;
        }

        var unnamed = ExternalId is not null && string.Equals(Name, ExternalId, StringComparison.Ordinal);
        if ((!NameFromProvider && !unnamed) || Name == normalized)
        {
            return false;
        }

        Name = normalized;
        NameFromProvider = true;
        return true;
    }

    /// <summary>
    /// Hands the membership to the identity provider: from now on the group is identified by this claim value and its members come
    /// only from the tokens. Members it has now stay until their next sign-in, which makes them match the claim. Linking a group to
    /// another id is the same call.
    /// </summary>
    public void Link(string externalId)
    {
        Guard.Against.InvalidInput(externalId,
            nameof(externalId),
            candidate => !string.IsNullOrWhiteSpace(candidate) && candidate.Trim().Length <= MaxExternalIdLength);
        ExternalId = externalId.Trim();
        Source = GroupSource.IdentityProvider;
        GraphSyncedAt = null;
    }

    /// <summary>Takes the group away from the identity provider: it is local again and keeps the members it has.</summary>
    public void Unlink()
    {
        ExternalId = null;
        Source = GroupSource.Local;
        NameFromProvider = false;
        GraphSyncedAt = null;
    }

    /// <summary>The rule for a group name, the room's: trimmed, 1 to <see cref="MaxNameLength"/> characters.</summary>
    public static bool TryNormalizeName(string? raw, out string name)
    {
        name = raw?.Trim() ?? string.Empty;
        return name.Length is >= 1 and <= MaxNameLength;
    }
}
