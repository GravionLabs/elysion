namespace Elysion.BusinessBackend.Api.Entities;

/// <summary>Who owns the members of a group (ADR 0027).</summary>
public enum GroupSource
{
    /// <summary>Made in Elysion; its members are added and removed by hand.</summary>
    Local = 0,

    /// <summary>Owned by the identity provider: the members come only from the <c>groups</c> claim of their tokens.</summary>
    IdentityProvider = 1
}
