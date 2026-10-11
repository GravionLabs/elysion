namespace Elysion.BusinessBackend.Api.Graph;

/// <summary>A person in a directory group: the object id, the name and the addresses the directory knows.</summary>
public sealed record GraphMember(string Id, string? DisplayName, string? Mail, string? UserPrincipalName)
{
    /// <summary>The address the person is recognised by: the mail address, else the sign-in name when it looks like one.</summary>
    public string? Email =>
        !string.IsNullOrWhiteSpace(Mail) ? Mail.Trim() :
        UserPrincipalName is { } upn && upn.Contains('@', StringComparison.Ordinal) ? upn.Trim() : null;
}

/// <summary>The part of Microsoft Graph that the group sync uses (#667).</summary>
public interface IGraphClient
{
    /// <summary>The display name of a group, or null when the directory has no such group.</summary>
    Task<string?> GetGroupNameAsync(string groupId, CancellationToken cancellationToken);

    /// <summary>The people in the group, nested groups included (<c>transitiveMembers</c>); devices, service principals and groups themselves are left out.</summary>
    Task<IReadOnlyList<GraphMember>> GetMembersAsync(string groupId, CancellationToken cancellationToken);
}

/// <summary>The directory could not be read; the message says why and never holds a secret.</summary>
public sealed class GraphException(string message, Exception? inner = null) : Exception(message, inner);
