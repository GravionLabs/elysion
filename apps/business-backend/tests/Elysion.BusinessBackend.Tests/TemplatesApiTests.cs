using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class TemplatesApiTests
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    [SetUp]
    public void SetUp()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateAuthenticatedClient();
    }

    [TearDown]
    public void TearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Test]
    public async Task The_list_holds_the_built_in_templates_without_scenes()
    {
        var response = await _client.GetAsync("/templates");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.ShouldNotContain("\"scene\"");
        var list = JsonSerializer.Deserialize<List<TemplateSummaryDto>>(body, JsonSerializerOptions.Web)!;
        list.Select(t => t.Name).ShouldBe(["Brainstorming", "Kanban", "Retrospective"]);
        list.ShouldAllBe(t => t.IsBuiltIn);
    }

    [Test]
    public async Task One_template_comes_with_its_scene()
    {
        var summary = (await _client.GetFromJsonAsync<List<TemplateSummaryDto>>("/templates"))![0];

        var template = await _client.GetFromJsonAsync<TemplateDto>($"/templates/{summary.Id}");

        template!.Name.ShouldBe(summary.Name);
        template.Scene.ShouldNotBeNullOrWhiteSpace();
    }

    [Test]
    public async Task An_unknown_template_and_a_non_guid_id_are_404()
    {
        (await _client.GetAsync($"/templates/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.GetAsync("/templates/nope")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Without_a_token_the_catalog_is_401()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.GetAsync("/templates")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    private const string Scene = """{"type":"excalidraw","version":2,"elements":[]}""";

    private static CreateTemplateRequest Request(string? name = "My template",
        string? description = "Mine",
        string? scene = Scene) => new(name, description, scene);

    private static async Task<TemplateDto> SaveAsync(HttpClient client, string name = "My template")
    {
        var response = await client.PostAsJsonAsync("/templates", Request(name));
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<TemplateDto>())!;
    }

    [Test]
    public async Task Saving_a_template_answers_201_with_its_scene_and_it_shows_up_in_the_list()
    {
        var response = await _client.PostAsJsonAsync("/templates", Request("  Planning  "));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var saved = (await response.Content.ReadFromJsonAsync<TemplateDto>())!;
        saved.Name.ShouldBe("Planning");
        saved.IsBuiltIn.ShouldBeFalse();
        saved.Scene.ShouldBe(Scene);
        response.Headers.Location!.AbsolutePath.ShouldBe($"/templates/{saved.Id}");
        var list = (await _client.GetFromJsonAsync<List<TemplateSummaryDto>>("/templates"))!;
        list.Select(t => t.Name).ShouldBe(["Brainstorming", "Kanban", "Retrospective", "Planning"]); // built-in first
        (await _client.GetFromJsonAsync<TemplateDto>($"/templates/{saved.Id}"))!.Scene.ShouldBe(Scene);
    }

    [Test]
    public async Task A_user_template_is_private_to_its_owner()
    {
        var saved = await SaveAsync(_client);
        using var other = _factory.CreateAuthenticatedClient("kc-sub-2");

        (await other.GetFromJsonAsync<List<TemplateSummaryDto>>("/templates"))!.Select(t => t.Name)
            .ShouldBe(["Brainstorming", "Kanban", "Retrospective"]);
        (await other.GetAsync($"/templates/{saved.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await other.DeleteAsync($"/templates/{saved.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.GetAsync($"/templates/{saved.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task The_owner_deletes_their_template_and_it_is_gone()
    {
        var saved = await SaveAsync(_client);

        (await _client.DeleteAsync($"/templates/{saved.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await _client.GetAsync($"/templates/{saved.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _client.DeleteAsync($"/templates/{saved.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_built_in_template_cannot_be_deleted()
    {
        var builtIn = (await _client.GetFromJsonAsync<List<TemplateSummaryDto>>("/templates"))![0];

        (await _client.DeleteAsync($"/templates/{builtIn.Id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await _client.GetAsync($"/templates/{builtIn.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [TestCase(null)]
    [TestCase("   ")]
    public async Task Saving_without_a_name_is_a_bad_request(string? name)
    {
        var response = await _client.PostAsJsonAsync("/templates", Request(name));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("\"name\"");
    }

    [Test]
    public async Task Saving_a_name_or_description_that_is_too_long_is_a_bad_request()
    {
        (await _client.PostAsJsonAsync("/templates", Request(new string('x', Template.MaxNameLength + 1))))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _client.PostAsJsonAsync("/templates",
                Request(description: new string('x', Template.MaxDescriptionLength + 1))))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("not json")]
    [TestCase("""{"hello":"world"}""")]
    [TestCase("""{"type":"excalidraw"}""")]
    [TestCase("""{"type":"other","elements":[]}""")]
    [TestCase("[]")]
    public async Task Saving_something_that_is_not_an_excalidraw_file_is_a_bad_request(string? scene)
    {
        var response = await _client.PostAsJsonAsync("/templates", Request(scene: scene));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("\"scene\"");
        (await _client.GetFromJsonAsync<List<TemplateSummaryDto>>("/templates"))!.Count.ShouldBe(3);
    }

    [Test]
    public async Task Saving_a_scene_over_the_size_limit_is_a_bad_request()
    {
        var padding = new string('x', Template.MaxSceneLength);
        var scene = $$"""{"type":"excalidraw","elements":[],"padding":"{{padding}}"}""";

        (await _client.PostAsJsonAsync("/templates", Request(scene: scene)))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Saving_and_deleting_need_a_token()
    {
        using var anonymous = _factory.CreateClient();

        (await anonymous.PostAsJsonAsync("/templates", Request())).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.DeleteAsync($"/templates/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Test]
    public void The_entity_refuses_a_scene_that_is_not_a_file_and_a_built_in_template_with_an_owner()
    {
        Should.Throw<ArgumentException>(() =>
            Template.Create(Guid.NewGuid(), "n", "", "nope", false, DateTimeOffset.UtcNow, Guid.NewGuid()));
        Should.Throw<ArgumentException>(() =>
            Template.Create(Guid.NewGuid(), "n", "", Scene, true, DateTimeOffset.UtcNow, Guid.NewGuid()));
        Should.Throw<ArgumentException>(() =>
            Template.Create(Guid.NewGuid(), "n", "", Scene, false, DateTimeOffset.UtcNow));
    }

    [Test]
    public void Every_seeded_scene_is_a_valid_excalidraw_file_with_elements()
    {
        var all = BuiltInTemplates.All();

        all.Count.ShouldBe(3);
        foreach (var template in all)
        {
            using var document = JsonDocument.Parse(template.Scene);
            var root = document.RootElement;
            root.GetProperty("type").GetString().ShouldBe("excalidraw", template.Name);
            root.GetProperty("elements").GetArrayLength().ShouldBeGreaterThan(0, template.Name);
            var ids = root.GetProperty("elements")
                .EnumerateArray()
                .Select(e => e.GetProperty("id").GetString())
                .ToList();
            ids.Distinct().Count().ShouldBe(ids.Count, $"{template.Name} has duplicate element ids");
        }
    }
}
