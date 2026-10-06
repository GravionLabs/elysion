using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;

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
