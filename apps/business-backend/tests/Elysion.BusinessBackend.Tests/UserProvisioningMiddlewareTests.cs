using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>Provisioning through the real pipeline: once per authenticated request, never for anonymous ones.</summary>
public class UserProvisioningMiddlewareTests
{
    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp() => _factory = new ApiFactory();

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private async Task<List<User>> UsersAsync()
    {
        using var scope = _factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ElysionDbContext>().Users.AsNoTracking().ToListAsync();
    }

    private static Claim[] Claims(string subject, string email) =>
        [new("sub", subject), new("email", email), new("preferred_username", "ada")];

    [Test]
    public async Task The_first_authenticated_request_creates_the_user_and_later_ones_reuse_it()
    {
        using var client = _factory.CreateAuthenticatedClient("kc-1");

        (await client.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await client.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var user = (await UsersAsync()).ShouldHaveSingleItem();
        (user.Subject, user.Email).ShouldBe(("kc-1", "kc-1@example.com"));
    }

    [Test]
    public async Task A_changed_email_in_a_later_token_updates_the_row()
    {
        using var before = _factory.CreateAuthenticatedClient("kc-1", Claims("kc-1", "old@example.com"));
        using var after = _factory.CreateAuthenticatedClient("kc-1", Claims("kc-1", "new@example.com"));

        await before.GetAsync("/boards");
        await after.GetAsync("/boards");

        var user = (await UsersAsync()).ShouldHaveSingleItem();
        (user.Email, user.DisplayName).ShouldBe(("new@example.com", "ada"));
    }

    [Test]
    public async Task Different_people_get_different_users()
    {
        using var ada = _factory.CreateAuthenticatedClient("kc-1");
        using var bob = _factory.CreateAuthenticatedClient("kc-2");

        await ada.GetAsync("/boards");
        await bob.GetAsync("/boards");

        (await UsersAsync()).Select(u => u.Subject).Order().ShouldBe(["kc-1", "kc-2"]);
    }

    [Test]
    public async Task Anonymous_endpoints_are_not_provisioned_even_with_a_valid_token()
    {
        using var client = _factory.CreateAuthenticatedClient("kc-1");
        using var internalClient = _factory.CreateInternalClient();

        (await client.GetAsync("/health")).StatusCode.ShouldBe(HttpStatusCode.OK);
        // The realtime service is no user: its token opens the internal API and creates nobody.
        (await internalClient.GetAsync("/internal/boards/some-board/document")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await UsersAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task Requests_without_a_valid_token_provision_nobody()
    {
        using var anonymous = _factory.CreateClient();
        using var wrongAudience = _factory.CreateClient();
        wrongAudience.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", ApiFactory.CreateToken(audience: "account"));

        await anonymous.GetAsync("/boards");
        await wrongAudience.GetAsync("/boards");

        (await UsersAsync()).ShouldBeEmpty();
    }

    [Test]
    public async Task A_valid_token_without_a_subject_is_401_and_creates_nothing()
    {
        using var client = _factory.CreateAuthenticatedClient(claims: [new Claim("email", "ada@example.com")]);

        (await client.GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        (await UsersAsync()).ShouldBeEmpty();
    }

    [Test]
    public void The_current_user_exists_only_after_provisioning()
    {
        var accessor = new CurrentUserAccessor();
        Should.Throw<InvalidOperationException>(() => accessor.Id);

        var user = User.Create(Guid.CreateVersion7(), "kc-1", "ada", "ada@example.com", DateTimeOffset.UtcNow);
        accessor.Set(user);

        (accessor.Id, accessor.Subject, accessor.DisplayName, accessor.Email)
            .ShouldBe((user.Id, "kc-1", "ada", "ada@example.com"));
    }
}
