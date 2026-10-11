using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Endpoints;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>Finding people by name or email to share with (#663).</summary>
public class UserSearchApiTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateAuthenticatedClient();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(
            User.Create(Guid.CreateVersion7(), "s1", "Erika Mustermann", "erika@example.com", Now),
            User.Create(Guid.CreateVersion7(), "s2", "Emil Muster", "emil.muster@example.com", Now),
            User.Create(Guid.CreateVersion7(), "s3", "Anna Weber", "anna@weber.example", Now),
            User.Create(Guid.CreateVersion7(), "s4", "No Email", null, Now),
            User.Create(Guid.CreateVersion7(), "s5", "100% Percent", "pct@example.com", Now));
        for (var i = 0; i < 14; i++)
        {
            db.Add(User.Create(Guid.CreateVersion7(), $"bulk{i}", $"Bulk Person {i:00}", $"bulk{i}@example.com", Now));
        }

        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private async Task<UserDto[]> SearchAsync(string query) =>
        (await _client.GetFromJsonAsync<UserDto[]>($"/users?query={Uri.EscapeDataString(query)}"))!;

    [Test]
    public async Task It_finds_a_person_by_part_of_the_name_without_regard_to_case()
    {
        (await SearchAsync("MUSTER")).Select(u => u.DisplayName)
            .ShouldBe(["Emil Muster", "Erika Mustermann"]); // the start of the name first, then by name
    }

    [Test]
    public async Task It_finds_a_person_by_the_start_of_the_email_or_any_part_of_it()
    {
        (await SearchAsync("anna@")).Select(u => u.DisplayName).ShouldBe(["Anna Weber"]);
        (await SearchAsync("weber.exa")).Select(u => u.DisplayName).ShouldBe(["Anna Weber"]);
        (await SearchAsync("emil.m")).Select(u => u.Email).ShouldBe(["emil.muster@example.com"]);
    }

    [Test]
    public async Task A_match_at_the_start_comes_before_a_match_in_the_middle()
    {
        (await SearchAsync("er")).Select(u => u.DisplayName).First().ShouldBe("Erika Mustermann");
    }

    [Test]
    public async Task It_returns_the_id_the_name_and_the_email_of_a_person_without_an_email_too()
    {
        var found = (await SearchAsync("No Em")).ShouldHaveSingleItem();

        found.DisplayName.ShouldBe("No Email");
        found.Email.ShouldBeNull();
        found.Id.ShouldNotBe(Guid.Empty);
    }

    [Test]
    public async Task It_returns_at_most_ten_people()
    {
        (await SearchAsync("bulk")).Length.ShouldBe(UserEndpoints.MaxResults);
    }

    [Test]
    public async Task The_characters_of_a_pattern_match_themselves_only()
    {
        (await SearchAsync("0% P")).Select(u => u.DisplayName).ShouldBe(["100% Percent"]);
        (await SearchAsync("%%")).ShouldBeEmpty(); // not "everything"
        (await SearchAsync("b_l")).ShouldBeEmpty(); // `_` is not "any character"
    }

    [TestCase("")]
    [TestCase("a")]
    [TestCase("  a ")]
    public async Task A_short_query_is_a_400_so_the_directory_cannot_be_listed(string query)
    {
        var response = await _client.GetAsync($"/users?query={Uri.EscapeDataString(query)}");

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task A_missing_or_very_long_query_is_a_400()
    {
        (await _client.GetAsync("/users")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _client.GetAsync($"/users?query={new string('a', UserEndpoints.MaxQueryLength + 1)}")).StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Without_a_token_nobody_is_found()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync("/users?query=anna")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
