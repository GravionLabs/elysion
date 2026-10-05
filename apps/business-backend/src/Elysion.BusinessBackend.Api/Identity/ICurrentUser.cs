namespace Elysion.BusinessBackend.Api.Identity;

/// <summary>
/// Who is calling, as a local user: the row for the token's subject, created or updated for this request.
/// Handlers and policies take this instead of reading claims themselves. Only available on endpoints that
/// require authentication (anonymous ones are not provisioned).
/// </summary>
public interface ICurrentUser
{
    Guid Id { get; }
    string Subject { get; }
    string DisplayName { get; }
    string? Email { get; }
}
