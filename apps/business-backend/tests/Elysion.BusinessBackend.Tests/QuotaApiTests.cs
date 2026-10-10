using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Quotas;

using Microsoft.AspNetCore.Mvc.Testing;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>What one person may keep (finding F6, #777): a request over a quota is a 409 that says so.</summary>
public class QuotaApiTests
{
    private const string Scene = """{"type":"excalidraw","version":2,"elements":[]}""";

    private ApiFactory _factory = null!;
    private WebApplicationFactory<Program> _limited = null!;

    [SetUp]
    public void SetUp()
    {
        _factory = new ApiFactory();
        _limited = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(QuotaOptions.MaxTemplatesSetting, "2");
            builder.UseSetting(QuotaOptions.MaxTemplateCharactersSetting, (Scene.Length * 4).ToString());
            builder.UseSetting(QuotaOptions.MaxBoardsSetting, "2");
        });
    }

    [TearDown]
    public void TearDown()
    {
        _limited.Dispose();
        _factory.Dispose();
    }

    private HttpClient ClientFor(string subject)
    {
        var client = _limited.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ApiFactory.CreateToken(subject));
        return client;
    }

    private static Task<HttpResponseMessage> SaveTemplate(HttpClient client, string name, string scene = Scene) =>
        client.PostAsJsonAsync("/templates", new CreateTemplateRequest(name, "", scene));

    [Test]
    public async Task A_person_may_keep_the_number_of_templates_the_quota_allows_and_not_one_more()
    {
        using var client = ClientFor("quota-templates");

        (await SaveTemplate(client, "one")).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await SaveTemplate(client, "two")).StatusCode.ShouldBe(HttpStatusCode.Created);
        var third = await SaveTemplate(client, "three");

        third.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await third.Content.ReadAsStringAsync()).ShouldContain("Template quota reached");
    }

    [Test]
    public async Task Deleting_a_template_makes_room()
    {
        using var client = ClientFor("quota-delete");
        var first = await (await SaveTemplate(client, "one")).Content.ReadFromJsonAsync<TemplateDto>();
        await SaveTemplate(client, "two");
        (await SaveTemplate(client, "three")).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        (await client.DeleteAsync($"/templates/{first!.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await SaveTemplate(client, "three")).StatusCode.ShouldBe(HttpStatusCode.Created);
    }

    [Test]
    public async Task The_scenes_of_a_persons_templates_together_have_a_size_limit_too()
    {
        using var client = ClientFor("quota-bytes");
        // A valid scene that holds two ordinary scenes' worth of characters.
        var big =
            $$"""{"type":"excalidraw","version":2,"elements":[],"note":"{{new string('x', Scene.Length * 2)}}"}""";

        (await SaveTemplate(client, "big", big)).StatusCode.ShouldBe(HttpStatusCode.Created);

        var second = await SaveTemplate(client, "second", big);

        second.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task One_persons_templates_do_not_count_for_another()
    {
        using var first = ClientFor("quota-a");
        using var second = ClientFor("quota-b");
        await SaveTemplate(first, "one");
        await SaveTemplate(first, "two");

        (await SaveTemplate(second, "mine")).StatusCode.ShouldBe(HttpStatusCode.Created);
    }

    [Test]
    public async Task A_person_may_own_the_number_of_boards_the_quota_allows_and_a_copy_counts()
    {
        using var client = ClientFor("quota-boards");
        (await client.PostAsJsonAsync("/boards", new BoardNameRequest("one"))).StatusCode.ShouldBe(HttpStatusCode
            .Created);
        var second = await client.PostAsJsonAsync("/boards", new BoardNameRequest("two"));
        second.StatusCode.ShouldBe(HttpStatusCode.Created);
        var board = await second.Content.ReadFromJsonAsync<BoardDto>();

        var third = await client.PostAsJsonAsync("/boards", new BoardNameRequest("three"));
        var copy = await client.PostAsync($"/boards/{board!.Id}/duplicate", null);

        third.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await third.Content.ReadAsStringAsync()).ShouldContain("Board quota reached");
        copy.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }
}
