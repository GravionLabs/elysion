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
    public bool IsAdministrator { get; private set; }
    public bool IsIntegration => Current.IsIntegration;
    public Guid? AccessTokenId { get; private set; }
    public IReadOnlyList<string> Scopes { get; private set; } = [];

    internal void Set(User user,
        bool isAdministrator = false,
        Guid? accessTokenId = null,
        IReadOnlyList<string>? scopes = null)
    {
        _user = user;
        IsAdministrator = isAdministrator;
        AccessTokenId = accessTokenId;
        Scopes = scopes ?? [];
    }

    private User Current => _user
                            ?? throw new InvalidOperationException(
                                "There is no current user: the request is anonymous or was not provisioned. Only endpoints that require authentication have one.");
}
