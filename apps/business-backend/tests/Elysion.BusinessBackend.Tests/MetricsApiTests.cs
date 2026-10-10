using System.Net;
using System.Net.Http.Headers;

using Elysion.BusinessBackend.Api.Observability;

using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

public class MetricsApiTests
{
    [Test]
    public async Task Metrics_are_served_without_a_token_and_list_requests_by_route_pattern()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ApiFactory.CreateToken());
        await client.GetAsync("/boards/0197a8d2-1c3e-7a10-8000-000000000001?token=SECRETVALUE");
        using var scraper = factory.CreateClient();

        var response = await scraper.GetAsync("/metrics");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var text = await response.Content.ReadAsStringAsync();
        text.ShouldContain("http_request_duration_seconds_bucket");
        text.ShouldContain("endpoint=\"/boards/{id:guid}\"");
        text.ShouldNotContain("SECRETVALUE");
        text.ShouldNotContain("0197a8d2-1c3e-7a10-8000-000000000001");
    }

    [Test]
    public async Task The_interceptor_counts_database_commands_by_outcome()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<DbContext>()
            .UseSqlite(connection)
            .AddInterceptors(new CommandCountInterceptor())
            .Options;
        await using var db = new DbContext(options);

        await db.Database.ExecuteSqlRawAsync("create table t (id integer)");
        await db.Database.ExecuteSqlRawAsync("insert into t values (1)");
        await db.Database.SqlQueryRaw<int>("select id as Value from t").ToListAsync();
        await Should.ThrowAsync<Exception>(() => db.Database.ExecuteSqlRawAsync("this is not sql"));

        using var output = new MemoryStream();
        await Prometheus.Metrics.DefaultRegistry.CollectAndExportAsTextAsync(output);
        var text = System.Text.Encoding.UTF8.GetString(output.ToArray());
        text.ShouldContain("elysion_backend_db_commands_total{outcome=\"ok\"}");
        text.ShouldContain("elysion_backend_db_commands_total{outcome=\"error\"} 1");
    }
}
