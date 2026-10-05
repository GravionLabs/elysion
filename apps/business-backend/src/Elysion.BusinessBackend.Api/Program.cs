using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Endpoints;
using Elysion.BusinessBackend.Api.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
// Keycloak access tokens are the only way in; endpoints that must stay open say so (docs/specs/identity.md).
builder.Services.AddElysionAuthentication();

builder.Services.AddDbContext<ElysionDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Elysion")));

// Endpoints depend on these, not on the DbContext (ADR 0015). The unit of work is the same scoped context.
builder.Services.AddScoped<IUnitOfWork>(services => services.GetRequiredService<ElysionDbContext>());
builder.Services.AddScoped<IBoardRepository, BoardRepository>();
builder.Services.AddScoped<IBoardDocumentRepository, BoardDocumentRepository>();

builder.Services.AddSingleton(TimeProvider.System);

var app = builder.Build();

// The containers of the dev stack start against an empty database: with Database:MigrateOnStartup the
// app applies the migrations itself. Off by default; the tests use a provider without migrations.
if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<ElysionDbContext>().Database.Migrate();
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.UseHttpsRedirection();

// Authentication has to run first: authorization only looks at the user it has established.
app.UseAuthentication();
app.UseAuthorization();

app.MapHealthEndpoints();
app.MapBoardEndpoints();
app.MapBoardDocumentEndpoints();

app.Run();

// Lets the test project host the app (WebApplicationFactory<Program>).
public partial class Program;
