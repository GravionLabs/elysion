using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
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
/// Personal access tokens (ADR 0033, #851): made by a person, shown once, stored as a hash, acting as their owner with their scopes
/// until they expire, are revoked or their owner is deactivated.
/// </summary>
public class AccessTokenApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly string[] AdminRoles = ["elysion-admin"];
    private static readonly string[] ReadScope = ["boards:read"];

    private sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private MutableTime _time = null!;
    private ApiFactory _factory = null!;

    [SetUp]
    public void SetUp()
    {
        _time = new MutableTime(Start);
        _factory = new ApiFactory(_time);
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    /// <summary>A person signed in with Keycloak; an administrator with the realm role.</summary>
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

    /// <summary>A client that sends a personal access token.</summary>
    private HttpClient WithToken(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static object Body(string name = "CI sync", string[]? scopes = null, int? days = 30) =>
        new { name, scopes = scopes ?? ["boards:read"], expiresInDays = days };

    private async Task<CreatedAccessTokenDto> CreateAsync(string subject = "ada", object? body = null)
    {
        var response = await Person(subject).PostAsync("/access-tokens", Json(body ?? Body()));
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<CreatedAccessTokenDto>(Web))!;
    }

    private async Task<T> InDb<T>(Func<ElysionDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    // ---------------------------------------------------------------- making one

    [Test]
    public async Task A_new_token_is_shown_once_with_its_prefix_scopes_and_expiry()
    {
        var created = await CreateAsync(body: Body(scopes: ["boards:write", "boards:read"], days: 90));

        created.Token.ShouldStartWith("elp_");
        created.Token.Length.ShouldBe(47);
        created.Token.ShouldMatch("^elp_[0-9A-Za-z]{43}$");
        created.Prefix.ShouldBe(created.Token[..12]);
        created.Name.ShouldBe("CI sync");
        created.Scopes.ShouldBe(["boards:read", "boards:write"]);
        created.CreatedAt.ShouldBe(Start);
        created.ExpiresAt.ShouldBe(Start.AddDays(90));
        created.LastUsedAt.ShouldBeNull();

        var list = await Person("ada").GetFromJsonAsync<JsonElement>("/access-tokens");
        list.GetArrayLength().ShouldBe(1);
        list[0].TryGetProperty("token", out _).ShouldBeFalse();
        list[0].GetProperty("prefix").GetString().ShouldBe(created.Prefix);
    }

    [Test]
    public async Task Only_the_hash_of_the_secret_is_stored()
    {
        var created = await CreateAsync();

        var stored = await InDb(db => db.AccessTokens.SingleAsync());
        var expected = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(created.Token)));
        stored.Hash.ShouldBe(expected);
        stored.Hash.ShouldNotContain(created.Token[4..]);
        stored.Prefix.ShouldBe(created.Token[..12]);
    }

    [Test]
    public async Task Two_tokens_are_never_the_same()
    {
        var first = await CreateAsync();
        var second = await CreateAsync();

        first.Token.ShouldNotBe(second.Token);
    }

    [TestCase(null, Description = "no name")]
    [TestCase("   ", Description = "a blank name")]
    public async Task A_token_needs_a_name(string? name)
    {
        var response = await Person("ada")
            .PostAsync("/access-tokens",
                Json(new { name, scopes = ReadScope, expiresInDays = 30 }));

        await ShouldBeValidationProblem(response, "name");
    }

    [Test]
    public async Task A_name_over_a_hundred_characters_is_refused_and_one_of_a_hundred_is_kept()
    {
        var response = await Person("ada").PostAsync("/access-tokens", Json(Body(name: new string('n', 101))));
        await ShouldBeValidationProblem(response, "name");

        (await CreateAsync(body: Body(name: new string('n', 100)))).Name.Length.ShouldBe(100);
    }

    [Test]
    public async Task A_token_needs_at_least_one_known_scope()
    {
        var none = await Person("ada").PostAsync("/access-tokens", Json(Body(scopes: [])));
        await ShouldBeValidationProblem(none, "scopes");

        var unknown = await Person("ada").PostAsync("/access-tokens", Json(Body(scopes: ["boards:read", "admin"])));
        await ShouldBeValidationProblem(unknown, "scopes");
    }

    [TestCase(null)]
    [TestCase(0)]
    [TestCase(366)]
    [TestCase(-1)]
    public async Task A_token_needs_an_expiry_of_at_most_a_year(int? days)
    {
        var response = await Person("ada").PostAsync("/access-tokens", Json(Body(days: days)));

        await ShouldBeValidationProblem(response, "expiresInDays");
    }

    [Test]
    public async Task A_token_of_one_day_and_one_of_a_year_are_made()
    {
        (await CreateAsync(body: Body(days: 1))).ExpiresAt.ShouldBe(Start.AddDays(1));
        (await CreateAsync(body: Body(days: 365))).ExpiresAt.ShouldBe(Start.AddDays(365));
    }

    [Test]
    public async Task A_request_without_a_json_body_is_415()
    {
        var response = await Person("ada").PostAsync("/access-tokens", new StringContent("x"));

        response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
    }

    [Test]
    public async Task A_person_with_fifty_active_tokens_must_revoke_one_first()
    {
        for (var i = 0; i < AccessToken.MaxActivePerOwner; i++)
        {
            await CreateAsync();
        }

        var response = await Person("ada").PostAsync("/access-tokens", Json(Body()));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task Making_a_token_is_in_the_audit_log_without_the_secret()
    {
        var created = await CreateAsync();

        var entry = await InDb(db => db.AuditEntries.SingleAsync(e => e.Action == AuditActions.TokenCreated));
        var ada = await InDb(db => db.Users.SingleAsync(u => u.Subject == "ada"));
        entry.SubjectType.ShouldBe(AuditActions.User);
        entry.SubjectId.ShouldBe(ada.Id);
        entry.ActorUserId.ShouldBe(ada.Id);
        entry.Details!.ShouldContain(created.Id.ToString());
        entry.Details!.ShouldContain("boards:read");
        entry.Details!.ShouldNotContain(created.Token);
        entry.Details!.ShouldNotContain(created.Prefix);
    }

    // ---------------------------------------------------------------- using one

    [Test]
    public async Task A_token_acts_as_its_owner_with_its_scopes()
    {
        var created = await CreateAsync(body: Body(scopes: ["boards:read", "members:write"]));

        var credential = await WithToken(created.Token).GetFromJsonAsync<CredentialDto>("/me/credential", Web);

        var ada = await InDb(db => db.Users.SingleAsync(u => u.Subject == "ada"));
        credential!.UserId.ShouldBe(ada.Id);
        credential.DisplayName.ShouldBe("ada");
        credential.Kind.ShouldBe("person");
        credential.TokenId.ShouldBe(created.Id);
        credential.Scopes.ShouldBe(["boards:read", "members:write"]);
    }

    [Test]
    public async Task A_person_with_a_keycloak_token_has_every_scope_and_no_token_id()
    {
        var credential = await Person("ada").GetFromJsonAsync<CredentialDto>("/me/credential", Web);

        credential!.TokenId.ShouldBeNull();
        credential.Scopes.ShouldBe(
            ["boards:read", "boards:write", "members:write", "snapshots:write", "webhooks:write"]);
    }

    [Test]
    public async Task A_token_sees_the_boards_of_its_owner_and_no_others()
    {
        var ada = await CreateAsync("ada");
        var created = await Person("bob").PostAsync("/boards", Json(new { name = "Bob's" }));
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        var bobsBoard = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        (await Person("ada").PostAsync("/boards", Json(new { name = "Ada's" }))).EnsureSuccessStatusCode();

        var boards = await WithToken(ada.Token).GetFromJsonAsync<JsonElement>("/boards");

        boards.EnumerateArray().Select(b => b.GetProperty("name").GetString()).ShouldBe(["Ada's"]);
        (await WithToken(ada.Token).GetAsync($"/boards/{bobsBoard}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_token_does_not_change_its_owners_name_or_email()
    {
        var created = await CreateAsync();

        (await WithToken(created.Token).GetAsync("/me/credential")).EnsureSuccessStatusCode();

        var ada = await InDb(db => db.Users.SingleAsync(u => u.Subject == "ada"));
        ada.Email.ShouldBe("ada@example.com");
        ada.DisplayName.ShouldBe("ada");
    }

    [Test]
    public async Task A_token_of_an_administrator_does_not_open_the_administration()
    {
        (await Person("root", admin: true).GetAsync("/admin/stats")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var created = await CreateAsync("root");

        var response = await WithToken(created.Token).GetAsync("/admin/stats");

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task An_unknown_or_malformed_token_is_401()
    {
        var unknown = "elp_" + new string('A', 43);
        (await WithToken(unknown).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await WithToken("elp_short").GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await WithToken("elp_" + new string('-', 43)).GetAsync("/boards")).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task An_expired_token_is_401_from_the_moment_it_expires()
    {
        var created = await CreateAsync(body: Body(days: 1));
        _time.Now = Start.AddDays(1).AddSeconds(-1);
        (await WithToken(created.Token).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);

        _time.Now = Start.AddDays(1);

        var response = await WithToken(created.Token).GetAsync("/boards");
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        response.Headers.WwwAuthenticate.ToString().ShouldBe("Bearer");
    }

    [Test]
    public async Task A_token_stops_working_at_once_when_its_owner_is_deactivated()
    {
        var created = await CreateAsync();
        (await WithToken(created.Token).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var ada = await InDb(db => db.Users.SingleAsync(u => u.Subject == "ada"));

        (await Person("root", admin: true).PostAsync($"/admin/users/{ada.Id}/deactivate", null))
            .EnsureSuccessStatusCode();

        var response = await WithToken(created.Token).GetAsync("/boards");
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await response.Content.ReadAsStringAsync()).ShouldContain("account-deactivated");
    }

    [Test]
    public async Task The_last_use_is_written_at_most_once_a_minute()
    {
        var created = await CreateAsync();

        async Task<DateTimeOffset?> LastUsed() =>
            (await InDb(db => db.AccessTokens.SingleAsync())).LastUsedAt;

        await WithToken(created.Token).GetAsync("/boards");
        (await LastUsed()).ShouldBe(Start);

        _time.Now = Start.AddSeconds(59);
        await WithToken(created.Token).GetAsync("/boards");
        (await LastUsed()).ShouldBe(Start);

        _time.Now = Start.AddSeconds(61);
        await WithToken(created.Token).GetAsync("/boards");
        (await LastUsed()).ShouldBe(Start.AddSeconds(61));
    }

    [Test]
    public async Task A_token_cannot_make_list_or_revoke_tokens()
    {
        var created = await CreateAsync(body: Body(scopes: ["boards:read", "boards:write", "webhooks:write"]));
        var client = WithToken(created.Token);

        (await client.PostAsync("/access-tokens", Json(Body()))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await client.GetAsync("/access-tokens")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await client.DeleteAsync($"/access-tokens/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---------------------------------------------------------------- revoking one

    [Test]
    public async Task A_revoked_token_is_401_at_once_and_leaves_the_list()
    {
        var created = await CreateAsync();
        (await WithToken(created.Token).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var revoked = await Person("ada").DeleteAsync($"/access-tokens/{created.Id}");

        revoked.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await WithToken(created.Token).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await Person("ada").GetFromJsonAsync<JsonElement>("/access-tokens")).GetArrayLength().ShouldBe(0);
    }

    [Test]
    public async Task Revoking_twice_writes_one_entry_in_the_audit_log()
    {
        var created = await CreateAsync();

        (await Person("ada").DeleteAsync($"/access-tokens/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await Person("ada").DeleteAsync($"/access-tokens/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var entries = await InDb(db => db.AuditEntries.Where(e => e.Action == AuditActions.TokenRevoked).ToListAsync());
        entries.Count.ShouldBe(1);
        entries[0].Details!.ShouldContain(created.Id.ToString());
    }

    [Test]
    public async Task Nobody_revokes_or_lists_another_persons_token()
    {
        var created = await CreateAsync("ada");

        (await Person("bob").DeleteAsync($"/access-tokens/{created.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await Person("bob").GetFromJsonAsync<JsonElement>("/access-tokens")).GetArrayLength().ShouldBe(0);
        (await WithToken(created.Token).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task An_unknown_token_id_is_404()
    {
        (await Person("ada").DeleteAsync($"/access-tokens/{Guid.CreateVersion7()}")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Without_a_login_the_token_routes_are_401()
    {
        var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync("/access-tokens")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.GetAsync("/me/credential")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    // ---------------------------------------------------------------- administration

    [Test]
    public async Task An_administrator_lists_every_token_with_its_owner_and_never_the_secret()
    {
        var ada = await CreateAsync("ada", Body(name: "Ada's sync"));
        _time.Now = Start.AddMinutes(1);
        await CreateAsync("bob", Body(name: "Bob's export"));

        var response = await Person("root", admin: true).GetAsync("/admin/access-tokens");

        var text = await response.Content.ReadAsStringAsync();
        text.ShouldNotContain(ada.Token);
        var page = JsonSerializer.Deserialize<PagedResult<AdminAccessTokenDto>>(text, Web)!;
        page.Total.ShouldBe(2);
        page.Items.Select(t => t.Name).ShouldBe(["Bob's export", "Ada's sync"]);
        page.Items[1].Owner.DisplayName.ShouldBe("ada");
        page.Items[1].Prefix.ShouldBe(ada.Prefix);

        var found = await Person("root", admin: true)
            .GetFromJsonAsync<PagedResult<AdminAccessTokenDto>>("/admin/access-tokens?query=BOB", Web);
        found!.Items.Select(t => t.Name).ShouldBe(["Bob's export"]);
    }

    [Test]
    public async Task An_administrator_revokes_any_token()
    {
        var created = await CreateAsync("ada");

        var response = await Person("root", admin: true).DeleteAsync($"/admin/access-tokens/{created.Id}");

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await WithToken(created.Token).GetAsync("/boards")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var listed = await Person("root", admin: true)
            .GetFromJsonAsync<PagedResult<AdminAccessTokenDto>>("/admin/access-tokens", Web);
        listed!.Items.Single().RevokedAt.ShouldBe(Start);
        var entry = await InDb(db => db.AuditEntries.SingleAsync(e => e.Action == AuditActions.TokenRevoked));
        var root = await InDb(db => db.Users.SingleAsync(u => u.Subject == "root"));
        entry.ActorUserId.ShouldBe(root.Id);
    }

    [Test]
    public async Task Only_an_administrator_lists_and_revokes_tokens_of_others()
    {
        var created = await CreateAsync("ada");

        (await Person("bob").GetAsync("/admin/access-tokens")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await Person("bob").DeleteAsync($"/admin/access-tokens/{created.Id}")).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
        (await Person("root", admin: true).DeleteAsync($"/admin/access-tokens/{Guid.CreateVersion7()}")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    private static async Task ShouldBeValidationProblem(HttpResponseMessage response, string field)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errors").TryGetProperty(field, out _).ShouldBeTrue();
    }
}
