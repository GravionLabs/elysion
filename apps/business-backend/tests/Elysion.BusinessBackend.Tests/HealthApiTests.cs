using System.Net;
using System.Net.Http.Json;
using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class HealthApiTests
{
    [Test]
    public async Task Health_answers_ok_without_any_setup()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        body.ShouldNotBeNull().ShouldContainKeyAndValue("status", "ok");
    }
}
