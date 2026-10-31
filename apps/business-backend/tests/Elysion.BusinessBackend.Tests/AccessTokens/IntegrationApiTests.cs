using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.AccessTokens;

/// <summary>
/// Integrations (ADR 0033, #851): a Keycloak service account with the realm role <c>elysion-integration</c> becomes a user of its own on
/// its first call, with no email, its client id as the name and the scopes of its token, and the access of a member.
/// </summary>
public class IntegrationApiTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly string[] AdminRoles = ["elysion-admin"];
    private static readonly string[] IntegrationRoles = ["elysion-integration"];
    private static readonly string[] ReadScope = ["boards:read"];

    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp() => _factory = new ApiFactory();

    [TearDown]
    public void TearDown() => _factory.Dispose();

    /// <summary>What Keycloak issues to a client with the client-credentials grant: the service account's subject, the client id as <c>azp</c>.</summary>
    private HttpClient Integration(string clientId = "ci-sync",
        string scope = "profile email boards:read boards:write",
        string role = "elysion-integration")
    {
        var subject = $"sa-{clientId}";
        return _factory.CreateAuthenticatedClient(subject,
        [
            new Claim("sub", subject), new Claim("azp", clientId),
            new Claim("preferred_username", $"service-account-{clientId}"), new Claim("scope", scope),
            new Claim("realm_access",
                JsonSerializer.Serialize(new { roles = new[] { "offline_access", role } }),
                JsonClaimValueTypes.Json),
        ]);
    }

    private HttpClient Person(string subject, bool admin = false)
    {
        var claims = new List<Claim>
        {
            new("sub", subject), new("email", $"{subject}@example.com"), new("preferred_username", subject),
        };
        if (admin)
        {
            claims.Add(new Claim("realm_access",
                JsonSerializer.Serialize(new { roles = AdminRoles }),
                JsonClaimValueTypes.Json));
        }

        return _factory.CreateAuthenticatedClient(subject, claims);
    }

    private async Task<User> UserAsync(string subject)
    {
        using var scope = _factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ElysionDbContext>()
            .Users
            .SingleAsync(u => u.Subject == subject);
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    [Test]
    public async Task The_first_call_makes_an_integration_user_named_after_the_client_without_an_email()
    {
        var credential = await Integration().GetFromJsonAsync<CredentialDto>("/me/credential", Web);

        var user = await UserAsync("sa-ci-sync");
        user.IsIntegration.ShouldBeTrue();
        user.DisplayName.ShouldBe("ci-sync");
        user.Email.ShouldBeNull();
        credential!.Kind.ShouldBe("integration");
        credential.DisplayName.ShouldBe("ci-sync");
        credential.TokenId.ShouldBeNull();
    }

    [Test]
    public async Task Its_scopes_are_the_known_ones_of_the_scope_claim()
    {
        var credential = await Integration(scope: "profile boards:write email webhooks:write unknown:thing")
            .GetFromJsonAsync<CredentialDto>("/me/credential", Web);

        credential!.Scopes.ShouldBe(["boards:write", "webhooks:write"]);
    }

    [Test]
    public async Task An_integration_without_a_scope_of_ours_has_none()
    {
        var credential = await Integration(scope: "profile email")
            .GetFromJsonAsync<CredentialDto>("/me/credential", Web);

        credential!.Scopes.ShouldBeEmpty();
    }

    [Test]
    public async Task A_service_account_without_the_role_is_a_person_as_before()
    {
        var credential = await Integration("other", role: "something-else")
            .GetFromJsonAsync<CredentialDto>("/me/credential", Web);

        credential!.Kind.ShouldBe("person");
        (await UserAsync("sa-other")).IsIntegration.ShouldBeFalse();
    }

    [Test]
    public async Task It_sees_the_boards_it_was_added_to_with_the_role_it_was_given_and_no_others()
    {
        await Integration().GetAsync("/me/credential");
        var integration = await UserAsync("sa-ci-sync");
        var shared = await (await Person("ada").PostAsync("/boards", Json(new { name = "Shared" })))
            .Content.ReadFromJsonAsync<JsonElement>();
        var sharedId = shared.GetProperty("id").GetString();
        var hidden = await (await Person("ada").PostAsync("/boards", Json(new { name = "Hidden" })))
            .Content.ReadFromJsonAsync<JsonElement>();
        (await Person("ada")
            .PostAsync($"/boards/{sharedId}/members",
                Json(new { userId = integration.Id, role = "Viewer" }))).EnsureSuccessStatusCode();

        var boards = await Integration().GetFromJsonAsync<JsonElement>("/boards");

        boards.EnumerateArray().Select(b => b.GetProperty("name").GetString()).ShouldBe(["Shared"]);
        (await Integration().GetAsync($"/boards/{hidden.GetProperty("id").GetString()}")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
        (await Integration().PatchAsync($"/boards/{sharedId}", Json(new { name = "Renamed" }))).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task The_member_search_says_it_is_an_integration()
    {
        await Integration().GetAsync("/me/credential");
        await Person("ci-person").GetAsync("/me/credential");

        var found = await Person("ada").GetFromJsonAsync<List<UserDto>>("/users?query=ci-", Web);

        found!.Single(u => u.DisplayName == "ci-sync").IsIntegration.ShouldBeTrue();
        found!.Single(u => u.DisplayName == "ci-person").IsIntegration.ShouldBeFalse();
    }

    [Test]
    public async Task An_integration_cannot_make_access_tokens()
    {
        var response = await Integration()
            .PostAsync("/access-tokens",
                Json(new { name = "x", scopes = ReadScope, expiresInDays = 1 }));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task The_administration_lists_integrations_apart_and_deactivates_them()
    {
        await Integration().GetAsync("/me/credential");
        await Person("ada").GetAsync("/me/credential");
        var admin = Person("root", admin: true);

        var integrations =
            await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/admin/users?kind=integration", Web);
        var people = await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/admin/users?kind=person", Web);
        var all = await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/admin/users", Web);

        integrations!.Items.Select(u => u.DisplayName).ShouldBe(["ci-sync"]);
        integrations.Items.Single().IsIntegration.ShouldBeTrue();
        people!.Items.Select(u => u.DisplayName).ShouldBe(["root", "ada"], ignoreOrder: true);
        all!.Total.ShouldBe(3);

        var id = integrations.Items.Single().Id;
        (await admin.PostAsync($"/admin/users/{id}/deactivate", null)).EnsureSuccessStatusCode();

        var refused = await Integration().GetAsync("/boards");
        refused.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await refused.Content.ReadAsStringAsync()).ShouldContain("account-deactivated");
        using var scope = _factory.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<ElysionDbContext>()
                .AuditEntries
                .CountAsync(e => e.Action == AuditActions.UserDeactivated && e.SubjectId == id))
            .ShouldBe(1);
    }

    [Test]
    public async Task An_integration_is_put_in_no_group_of_the_identity_provider()
    {
        var subject = "sa-grouped";
        var client = _factory.CreateAuthenticatedClient(subject,
        [
            new Claim("sub", subject), new Claim("azp", "grouped"), new Claim("groups", "engineering"),
            new Claim("realm_access",
                JsonSerializer.Serialize(new { roles = IntegrationRoles }),
                JsonClaimValueTypes.Json),
        ]);

        await client.GetAsync("/me/credential");

        using var scope = _factory.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<ElysionDbContext>().GroupMemberships.CountAsync())
            .ShouldBe(0);
    }
}
