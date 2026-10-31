using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Webhooks;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>A board with an owner, an editor and a viewer, a stranger, an administrator and a clock the test moves.</summary>
public abstract class WebhookTestBase
{
    protected static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    protected static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    protected static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly string[] AdminRoles = ["elysion-admin"];

    protected ApiFactory Factory { get; private set; } = null!;
    protected MutableTime Time { get; private set; } = null!;
    protected Board Board { get; private set; } = null!;
    protected Dictionary<string, User> Users { get; } = [];

    protected virtual bool RealWebhooks => false;

    [SetUp]
    public async Task SetUpBoard()
    {
        Time = new MutableTime(Start);
        Factory = new ApiFactory(Time) { RealWebhooks = RealWebhooks };
        foreach (var name in new[] { "owner", "editor", "viewer", "stranger", "admin" })
        {
            Users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Start);
        }

        Board = Board.Create(Guid.CreateVersion7(), "Retro", Start, Users["owner"].Id);
        await InDb(db =>
        {
            db.AddRange(Users.Values);
            db.AddRange(Board,
                BoardMembership.Create(Board.Id, Users["owner"].Id, BoardRole.Owner, Start),
                BoardMembership.Create(Board.Id, Users["editor"].Id, BoardRole.Editor, Start),
                BoardMembership.Create(Board.Id, Users["viewer"].Id, BoardRole.Viewer, Start));
            return Task.CompletedTask;
        });
    }

    [TearDown]
    public void TearDownFactory() => Factory.Dispose();

    protected async Task InDb(Func<ElysionDbContext, Task> action)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        await action(db);
        await db.SaveChangesAsync();
    }

    protected async Task<T> Query<T>(Func<ElysionDbContext, Task<T>> query)
    {
        using var scope = Factory.Services.CreateScope();
        return await query(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    protected Task<List<WebhookDelivery>> Deliveries() =>
        Query(db => db.WebhookDeliveries.AsNoTracking().OrderBy(d => d.CreatedAt).ThenBy(d => d.Id).ToListAsync());

    protected HttpClient As(string name)
    {
        var claims = new List<Claim>
            { new("sub", name), new("email", $"{name}@example.com"), new("preferred_username", name) };
        if (name == "admin")
        {
            claims.Add(new Claim("realm_access",
                JsonSerializer.Serialize(new { roles = AdminRoles }),
                JsonClaimValueTypes.Json));
        }

        return Factory.CreateAuthenticatedClient(name, claims);
    }

    protected static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    /// <summary>Registers a webhook on the board as its owner and returns the answer (with the secret).</summary>
    protected async Task<JsonElement> RegisterAsync(string url = "https://hooks.example.com/elysion",
        string[]? events = null,
        string path = "")
    {
        using var owner = As(path.Length == 0 ? "owner" : "admin");
        var response = await owner.PostAsync(path.Length == 0 ? $"/boards/{Board.Id}/webhooks" : path,
            Json(new { url, events = events ?? [] }));
        response.StatusCode.ShouldBe(System.Net.HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>(Web);
    }

    protected Task<int> RunWorkerAsync() =>
        Factory.Services.GetRequiredService<WebhookDeliveryService>().RunOnceAsync(Ct);

    /// <summary>Saves a board document as the realtime service does.</summary>
    protected async Task SaveDocumentAsync(long? basedOn, byte[] state, string? reason = null)
    {
        using var client = Factory.CreateInternalClient();
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/internal/boards/{Board.Id}/document");
        request.Content = new ByteArrayContent(state);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        if (basedOn is { } version)
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        else
            request.Headers.TryAddWithoutValidation("If-None-Match", "*");
        if (reason is not null)
            request.Headers.TryAddWithoutValidation("X-Elysion-Save-Reason", reason);
        var response = await client.SendAsync(request);
        response.StatusCode.ShouldBe(System.Net.HttpStatusCode.NoContent);
    }

    protected sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }
}
