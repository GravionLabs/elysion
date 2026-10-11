using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Graph;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

using NSubstitute;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>The background job (#667): off without its settings, and a run that goes wrong is logged, not thrown.</summary>
public class GraphSyncServiceTests
{
    private static GraphSyncService Service(GraphOptions options,
        IGroupSyncRepository store,
        IGraphClient? graph = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(graph ?? Substitute.For<IGraphClient>());
        services.AddSingleton(store);
        services.AddSingleton(Substitute.For<IAuditLog>());
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<ILogger<GraphGroupSync>>(NullLogger<GraphGroupSync>.Instance);
        services.AddScoped<GraphGroupSync>();
        var provider = services.BuildServiceProvider();
        return new GraphSyncService(provider.GetRequiredService<IServiceScopeFactory>(),
            Microsoft.Extensions.Options.Options.Create(options),
            TimeProvider.System,
            NullLogger<GraphSyncService>.Instance);
    }

    [Test]
    public async Task Without_its_settings_the_job_does_nothing_and_never_asks_the_directory()
    {
        var store = Substitute.For<IGroupSyncRepository>();
        var graph = Substitute.For<IGraphClient>();
        using var service = Service(new GraphOptions(), store, graph);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        await store.DidNotReceiveWithAnyArgs().ListLinkedAsync(default);
        await graph.DidNotReceiveWithAnyArgs().GetMembersAsync(default!, default);
    }

    [Test]
    public async Task A_run_reports_how_many_groups_it_read()
    {
        var store = Substitute.For<IGroupSyncRepository>();
        store.ListLinkedAsync(Arg.Any<CancellationToken>()).Returns(Task.FromResult<IReadOnlyList<Group>>([]));
        using var service = Service(new GraphOptions { TenantId = "t", ClientId = "c", ClientSecret = "s" }, store);

        var run = await service.RunOnceAsync(CancellationToken.None);

        run.ShouldBe(new GraphSyncRun(0, 0, 0));
    }

    [Test]
    public async Task A_run_that_throws_is_logged_and_the_job_goes_on()
    {
        var store = Substitute.For<IGroupSyncRepository>();
        store.ListLinkedAsync(Arg.Any<CancellationToken>())
            .Returns<IReadOnlyList<Group>>(_ => throw new InvalidOperationException("database is down"));
        using var service = Service(new GraphOptions { TenantId = "t", ClientId = "c", ClientSecret = "s" }, store);

        (await service.RunOnceAsync(CancellationToken.None)).ShouldBeNull();
    }

    [Test]
    public async Task Cancelling_a_run_is_not_swallowed()
    {
        var store = Substitute.For<IGroupSyncRepository>();
        store.ListLinkedAsync(Arg.Any<CancellationToken>())
            .Returns<IReadOnlyList<Group>>(_ => throw new OperationCanceledException());
        using var service = Service(new GraphOptions { TenantId = "t", ClientId = "c", ClientSecret = "s" }, store);
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Should.ThrowAsync<OperationCanceledException>(() => service.RunOnceAsync(cancelled.Token));
    }
}
