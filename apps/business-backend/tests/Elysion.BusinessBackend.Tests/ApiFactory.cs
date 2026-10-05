using Elysion.BusinessBackend.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// Runs the real application pipeline (routing, model binding, validation, controllers) with an
/// in-memory database instead of Postgres, so no infrastructure is needed.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _databaseName = Guid.NewGuid().ToString();
    private readonly TimeProvider? _time;

    public ApiFactory(TimeProvider? time = null) => _time = time;

    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.ConfigureServices(services =>
        {
            // EF registers the provider in two places; both have to go or two providers coexist. The
            // second one (IDbContextOptionsConfiguration<T>) is an internal EF type, so it is matched by name.
            services.RemoveAll<DbContextOptions<ElysionDbContext>>();
            foreach (var descriptor in services
                         .Where(d => d.ServiceType is { IsGenericType: true } type
                             && type.GetGenericTypeDefinition().Name == "IDbContextOptionsConfiguration`1"
                             && type.GenericTypeArguments[0] == typeof(ElysionDbContext))
                         .ToList())
            {
                services.Remove(descriptor);
            }

            services.AddDbContext<ElysionDbContext>(options => options.UseInMemoryDatabase(_databaseName));

            if (_time is not null)
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(_time);
            }
        });
}
