using Elysion.BusinessBackend.Api.Authorization;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Endpoints;
using Elysion.BusinessBackend.Api.Files;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Logging;
using Elysion.BusinessBackend.Api.Members;
using Elysion.BusinessBackend.Api.Observability;

using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Serilog, JSON lines on stdout, one line per request (ADR 0025).
builder.AddElysionLogging();

// Add services to the container.

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
// Keycloak access tokens are the only way in; endpoints that must stay open say so (docs/specs/identity.md).
builder.Services.AddElysionAuthentication();
builder.Services.AddBoardAuthorization();
// The files of boards (images) live in an S3-compatible store, not in the shared document (#702).
builder.Services.AddElysionFileStorage();

builder.Services.AddDbContext<ElysionDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Elysion"))
        .AddInterceptors(new CommandCountInterceptor()));

// Endpoints depend on these, not on the DbContext (ADR 0015). The unit of work is the same scoped context.
builder.Services.AddScoped<IUnitOfWork>(services => services.GetRequiredService<ElysionDbContext>());
builder.Services.AddScoped<IBoardRepository, BoardRepository>();
builder.Services.AddScoped<IBoardDocumentRepository, BoardDocumentRepository>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IMembershipRepository, MembershipRepository>();
builder.Services.AddScoped<IRoomRepository, RoomRepository>();
builder.Services.AddScoped<IRoomMembershipRepository, RoomMembershipRepository>();
builder.Services.AddScoped<ITemplateRepository, TemplateRepository>();
builder.Services.AddScoped<BoardMemberService>();
builder.Services.AddScoped<RoomMemberService>();

// The caller as a local user, provisioned from the token once per authenticated request.
builder.Services.AddScoped<UserProvisioningService>();
builder.Services.AddScoped<CurrentUserAccessor>();
builder.Services.AddScoped<ICurrentUser>(services => services.GetRequiredService<CurrentUserAccessor>());

builder.Services.AddSingleton(TimeProvider.System);

var app = builder.Build();

// The containers of the dev stack start against an empty database: with Database:MigrateOnStartup the
// app applies the migrations itself. Off by default; the tests use a provider without migrations.
// `--migrate` applies them and exits without serving: the Helm chart runs it once, as a job before an install or upgrade,
// so that several replicas never migrate at the same time.
var migrateOnly = args.Contains("--migrate");
if (migrateOnly || app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<ElysionDbContext>().Database.Migrate();
}

if (migrateOnly)
{
    return;
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

// The request id first, so that every line of the request carries it; then the one line per request.
app.UseElysionRequestId();

app.UseHttpsRedirection();

// After routing is known (the route pattern is a label), before authentication so refused requests count too.
app.UseElysionHttpMetrics();

// Authentication has to run first: authorization only looks at the user it has established.
app.UseAuthentication();
app.UseMiddleware<UserIdLogMiddleware>();
app.UseMiddleware<UserProvisioningMiddleware>();
app.UseAuthorization();

app.MapHealthEndpoints();
app.MapElysionMetrics();
app.MapBoardEndpoints();
app.MapBoardMemberEndpoints();
app.MapRoomEndpoints();
app.MapRoomMemberEndpoints();
app.MapBoardDocumentEndpoints();
app.MapBoardAccessEndpoints();
app.MapBoardFileEndpoints();
app.MapTemplateEndpoints();

app.Run();

// Lets the test project host the app (WebApplicationFactory<Program>).
public partial class Program;
