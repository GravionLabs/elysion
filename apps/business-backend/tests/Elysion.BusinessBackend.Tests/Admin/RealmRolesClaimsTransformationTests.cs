using System.Security.Claims;

using Elysion.BusinessBackend.Api.Identity;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Admin;

/// <summary>The roles of a Keycloak token (<c>realm_access.roles</c>) become plain role claims (ADR 0027).</summary>
public class RealmRolesClaimsTransformationTests
{
    private static ClaimsPrincipal With(string? realmAccess)
    {
        var claims = new List<Claim> { new("sub", "kc-1") };
        if (realmAccess is not null)
        {
            claims.Add(new Claim(RealmRolesClaimsTransformation.RealmAccessClaim, realmAccess));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    private static Task<ClaimsPrincipal> Transform(ClaimsPrincipal principal) =>
        new RealmRolesClaimsTransformation().TransformAsync(principal);

    [Test]
    public async Task Each_realm_role_becomes_a_role_claim()
    {
        var principal = await Transform(With("""{"roles":["offline_access","elysion-admin"]}"""));

        principal.IsInRole("elysion-admin").ShouldBeTrue();
        principal.IsInRole("offline_access").ShouldBeTrue();
        principal.IsInRole("other").ShouldBeFalse();
    }

    [Test]
    public async Task The_roles_of_clients_are_not_realm_roles()
    {
        var principal = await Transform(
            With("""{"roles":["board-user"]}""").AddClaim("resource_access", """{"x":{"roles":["elysion-admin"]}}"""));

        principal.IsInRole("elysion-admin").ShouldBeFalse();
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("not json")]
    [TestCase("[]")]
    [TestCase("""{"roles":"elysion-admin"}""")]
    [TestCase("""{"roles":[1,null,{"a":1},""]}""")]
    [TestCase("""{"other":["elysion-admin"]}""")]
    public async Task A_value_that_is_not_the_expected_shape_gives_no_role(string? realmAccess)
    {
        var principal = await Transform(With(realmAccess));

        principal.FindAll(ClaimTypes.Role).ShouldBeEmpty();
    }

    [Test]
    public async Task Running_twice_adds_the_roles_once()
    {
        var once = await Transform(With("""{"roles":["elysion-admin"]}"""));
        var twice = await Transform(once);

        twice.FindAll(ClaimTypes.Role).Count().ShouldBe(1);
    }

    [Test]
    public async Task The_original_claims_stay()
    {
        var principal = await Transform(With("""{"roles":["elysion-admin"]}"""));

        principal.FindFirst("sub")!.Value.ShouldBe("kc-1");
        principal.Identity!.IsAuthenticated.ShouldBeTrue();
    }
}

internal static class PrincipalExtensions
{
    public static ClaimsPrincipal AddClaim(this ClaimsPrincipal principal, string type, string value)
    {
        ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim(type, value));
        return principal;
    }
}
