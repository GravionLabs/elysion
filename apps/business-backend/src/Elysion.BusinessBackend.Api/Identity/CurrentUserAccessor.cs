using Elysion.BusinessBackend.Api.Entities;

namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>The scoped holder of the request's user. The provisioning middleware fills it; nothing else does.</summary>
public sealed class CurrentUserAccessor : ICurrentUser
{
    private User? _user;

    public Guid Id => Current.Id;
    public string Subject => Current.Subject;
    public string DisplayName => Current.DisplayName;
    public string? Email => Current.Email;

    internal void Set(User user) => _user = user;

    private User Current => _user
        ?? throw new InvalidOperationException(
            "There is no current user: the request is anonymous or was not provisioned. Only endpoints that require authentication have one.");
}
