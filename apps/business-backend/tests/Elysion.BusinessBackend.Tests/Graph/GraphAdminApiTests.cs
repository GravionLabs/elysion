using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>What the administrator sees of the Graph sync (#667): the last sync, the pending people, and the rules for names and links.</summary>
public class GraphAdminApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly string[] Roles = ["offline_access", "elysion-admin"];
    private ApiFactory _factory = null!;
    private HttpClient _admin = null!;
    private Guid _linked;
    private Guid _local;

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        _admin = _factory.CreateAuthenticatedClient("kc-admin",
        [
            new Claim("sub", "kc-admin"), new("email", "admin@example.com"), new("preferred_username", "admin"),
            new Claim("realm_access", JsonSerializer.Serialize(new { roles = Roles }), JsonClaimValueTypes.Json)
        ]);
        var linked = Group.Linked(Guid.CreateVersion7(), "11111111-1111-4111-8111-111111111111", "Engineering", Start);
        linked.Name = "Engineering Directory"; // as the sync named it
        linked.NameFromProvider = true;
        linked.GraphSyncedAt = Start.AddHours(1);
        var local = Group.Create(Guid.CreateVersion7(), "Staff", Start);
        _linked = linked.Id;
        _local = local.Id;
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(linked,
            local,
            PendingGroupMembership.Create(linked.Id, "Zoe@Example.com", "Zoe Z", "oid-zoe", Start),
            PendingGroupMembership.Create(linked.Id, "adam@example.com", null, null, Start));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown()
    {
        _admin.Dispose();
        _factory.Dispose();
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private async Task<T> InDb<T>(Func<ElysionDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    [Test]
    public async Task The_group_list_shows_the_pending_count_and_when_the_sync_last_read_the_group()
    {
        var groups = (await _admin.GetFromJsonAsync<PagedResult<AdminGroupDto>>("/admin/groups"))!.Items;

        var linked = groups.Single(g => g.Id == _linked);
        linked.Name.ShouldBe("Engineering Directory");
        linked.PendingCount.ShouldBe(2);
        linked.LastSyncAt.ShouldBe(Start.AddHours(1));
        groups.Single(g => g.Id == _local).PendingCount.ShouldBe(0);
        groups.Single(g => g.Id == _local).LastSyncAt.ShouldBeNull();
    }

    [Test]
    public async Task The_pending_people_of_a_group_are_listed_by_address()
    {
        var pending =
            (await _admin.GetFromJsonAsync<PagedResult<AdminPendingMemberDto>>($"/admin/groups/{_linked}/pending"))!;

        pending.Total.ShouldBe(2);
        pending.Items.Select(p => p.Email).ShouldBe(["adam@example.com", "zoe@example.com"]);
        pending.Items.Single(p => p.Email == "zoe@example.com").DisplayName.ShouldBe("Zoe Z");
    }

    [Test]
    public async Task An_unknown_group_has_no_pending_list()
    {
        (await _admin.GetAsync($"/admin/groups/{Guid.NewGuid()}/pending")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task The_status_says_that_the_sync_is_off_here_and_when_it_last_ran()
    {
        var status = (await _admin.GetFromJsonAsync<AdminGraphStatusDto>("/admin/graph"))!;

        status.Enabled.ShouldBeFalse();
        status.LastSyncAt.ShouldBe(Start.AddHours(1));
        status.PendingMembers.ShouldBe(2);
        status.IntervalMinutes.ShouldBe(60);
    }

    [Test]
    public async Task An_administrators_rename_stops_the_sync_from_following_the_directory()
    {
        var response = await _admin.PatchAsync($"/admin/groups/{_linked}", Json(new { name = "Our engineers" }));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var group = await InDb(db => db.Groups.AsNoTracking().SingleAsync(g => g.Id == _linked));
        group.Name.ShouldBe("Our engineers");
        group.NameFromProvider.ShouldBeFalse();
        group.NameFromDirectory("Directory name again").ShouldBeFalse();
    }

    [Test]
    public async Task Unlinking_a_group_forgets_its_pending_people()
    {
        var response = await _admin.PatchAsync($"/admin/groups/{_linked}", Json(new { externalId = (string?)null }));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        (await InDb(db => db.PendingGroupMemberships.CountAsync(p => p.GroupId == _linked))).ShouldBe(0);
        var group = await InDb(db => db.Groups.AsNoTracking().SingleAsync(g => g.Id == _linked));
        group.GraphSyncedAt.ShouldBeNull();
        group.NameFromProvider.ShouldBeFalse();
    }

    [Test]
    public async Task Linking_a_group_to_another_id_starts_over_for_the_sync()
    {
        var response = await _admin.PatchAsync($"/admin/groups/{_linked}",
            Json(new { externalId = "22222222-2222-4222-8222-222222222222" }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await InDb(db => db.Groups.AsNoTracking().SingleAsync(g => g.Id == _linked))).GraphSyncedAt.ShouldBeNull();
    }
}
