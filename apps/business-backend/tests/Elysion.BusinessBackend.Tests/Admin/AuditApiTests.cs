using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Admin;

/// <summary>The audit log (#669): who changed who may see what, what it keeps and who may read it.</summary>
public class AuditApiTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly string[] AdminRoles = ["elysion-admin"];

    private sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private MutableTime _time = null!;
    private ApiFactory _factory = null!;
    private Board _board = null!;
    private Room _room = null!;
    private readonly Dictionary<string, User> _users = [];

    [SetUp]
    public async Task SetUp()
    {
        _time = new MutableTime(Start);
        _factory = new ApiFactory(_time);
        foreach (var name in new[] { "owner", "editor", "newcomer" })
        {
            _users[name] = User.Create(Guid.CreateVersion7(), name, name, $"{name}@example.com", Start);
        }

        _board = Board.Create(Guid.CreateVersion7(), "Retro", Start, _users["owner"].Id);
        _room = Room.Create(Guid.CreateVersion7(), "Team", Start, _users["owner"].Id);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ElysionDbContext>();
        db.AddRange(_users.Values);
        db.AddRange(_board,
            _room,
            BoardMembership.Create(_board.Id, _users["owner"].Id, BoardRole.Owner, Start),
            BoardMembership.Create(_board.Id, _users["editor"].Id, BoardRole.Editor, Start),
            RoomMembership.Create(_room.Id, _users["owner"].Id, BoardRole.Owner, Start));
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _factory.Dispose();

    private HttpClient As(string name, string[]? roles = null, params string[] groups)
    {
        var claims = new List<Claim>
        {
            new("sub", name), new("email", $"{name}@example.com"), new("preferred_username", name)
        };
        claims.AddRange(groups.Select(g => new Claim("groups", g)));
        if (roles is not null)
        {
            claims.Add(new Claim("realm_access", JsonSerializer.Serialize(new { roles }), JsonClaimValueTypes.Json));
        }

        return _factory.CreateAuthenticatedClient(name, claims);
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private async Task<IReadOnlyList<AuditEntryDto>> History(string url, string as_ = "owner")
    {
        using var client = As(as_);
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<List<AuditEntryDto>>())!;
    }

    private async Task<PagedResult<AuditEntryDto>> Audit(string query = "")
    {
        using var admin = As("root", AdminRoles);
        var response = await admin.GetAsync($"/admin/audit{query}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<PagedResult<AuditEntryDto>>())!;
    }

    private async Task<T> InDb<T>(Func<ElysionDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<ElysionDbContext>());
    }

    // ------------------------------------------------------------ members of a board and a room

    [Test]
    public async Task Adding_changing_and_removing_a_board_member_are_entries_of_the_board()
    {
        var who = _users["newcomer"].Id;
        using var owner = As("owner");
        (await owner.PostAsync($"/boards/{_board.Id}/members",
                Json(new { email = "newcomer@example.com", role = "Viewer" })))
            .StatusCode.ShouldBe(HttpStatusCode.Created);
        _time.Now = Start.AddMinutes(1);
        (await owner.PatchAsync($"/boards/{_board.Id}/members/{who}", Json(new { role = "Editor" })))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
        _time.Now = Start.AddMinutes(2);
        (await owner.DeleteAsync($"/boards/{_board.Id}/members/{who}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var entries = await History($"/boards/{_board.Id}/history");

        entries.Select(e => e.Action)
            .ShouldBe([AuditActions.MemberRemoved, AuditActions.MemberRoleChanged, AuditActions.MemberAdded]);
        entries.ShouldAllBe(e => e.SubjectType == "board" && e.SubjectId == _board.Id && e.SubjectName == "Retro");
        entries.ShouldAllBe(e => e.Actor != null && e.Actor.DisplayName == "owner");
        entries[2].Details!.Value.GetProperty("role").GetString().ShouldBe("Viewer");
        entries[1].Details!.Value.GetProperty("from").GetString().ShouldBe("Viewer");
        entries[1].Details!.Value.GetProperty("to").GetString().ShouldBe("Editor");
        entries[0].Details!.Value.GetProperty("userId").GetGuid().ShouldBe(who);
        entries.ShouldAllBe(e => e.Target != null && e.Target.DisplayName == "newcomer"); // the person it was done to
    }

    [Test]
    public async Task A_room_has_its_own_history()
    {
        using var owner = As("owner");
        await owner.PostAsync($"/rooms/{_room.Id}/members",
            Json(new { email = "editor@example.com", role = "Editor" }));

        var entries = await History($"/rooms/{_room.Id}/history");

        entries.Single().Action.ShouldBe(AuditActions.MemberAdded);
        entries.Single().SubjectType.ShouldBe("room");
        (await History($"/boards/{_board.Id}/history")).ShouldBeEmpty();
    }

    [Test]
    public async Task The_history_shows_the_last_twenty_entries_newest_first()
    {
        using var owner = As("owner");
        await owner.PostAsync($"/boards/{_board.Id}/members",
            Json(new { email = "newcomer@example.com", role = "Viewer" }));
        for (var i = 0; i < 12; i++)
        {
            _time.Now = Start.AddMinutes(i + 1);
            await owner.PatchAsync($"/boards/{_board.Id}/members/{_users["newcomer"].Id}",
                Json(new { role = i % 2 == 0 ? "Editor" : "Viewer" }));
            await owner.PostAsync($"/boards/{_board.Id}/invitations",
                Json(new { role = "Viewer", expiresInHours = 2 }));
        }

        var entries = await History($"/boards/{_board.Id}/history");

        entries.Count.ShouldBe(HistoryLimit);
        entries.Select(e => e.At).ShouldBe(entries.Select(e => e.At).OrderByDescending(at => at));
    }

    private const int HistoryLimit = 20;

    [Test]
    public async Task Only_an_owner_reads_the_history()
    {
        using var editor = As("editor");
        using var stranger = As("newcomer");

        (await editor.GetAsync($"/boards/{_board.Id}/history")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await stranger.GetAsync($"/boards/{_board.Id}/history")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await editor.GetAsync($"/rooms/{_room.Id}/history")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_refused_change_leaves_no_entry()
    {
        using var owner = As("owner");
        // A person nobody knows, and the last owner who cannot be demoted.
        (await owner.PostAsync($"/boards/{_board.Id}/members",
                Json(new { email = "nobody@example.com", role = "Viewer" })))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await History($"/boards/{_board.Id}/history")).ShouldBeEmpty();
    }

    // ------------------------------------------------------------ groups

    [Test]
    public async Task The_administration_of_groups_is_written_down()
    {
        using var admin = As("root", AdminRoles);
        var created = await admin.PostAsync("/admin/groups", Json(new { name = "Staff" }));
        var group = (await created.Content.ReadFromJsonAsync<AdminGroupDto>())!;
        await admin.PatchAsync($"/admin/groups/{group.Id}", Json(new { name = "Employees" }));
        await admin.PatchAsync($"/admin/groups/{group.Id}", Json(new { externalId = "ext-1" }));
        await admin.PatchAsync($"/admin/groups/{group.Id}", Json(new { externalId = (string?)null }));
        await admin.PutAsync($"/admin/groups/{group.Id}/members/{_users["editor"].Id}", null);
        await admin.DeleteAsync($"/admin/groups/{group.Id}/members/{_users["editor"].Id}");
        await admin.DeleteAsync($"/admin/groups/{group.Id}");

        var actions = (await Audit($"?subject={group.Id}")).Items.Select(e => e.Action).Reverse().ToList();

        actions.ShouldBe([
            AuditActions.GroupCreated, AuditActions.GroupRenamed, AuditActions.GroupLinked, AuditActions.GroupUnlinked,
            AuditActions.GroupMemberAdded, AuditActions.GroupMemberRemoved, AuditActions.GroupDeleted
        ]);
    }

    [Test]
    public async Task Changing_nothing_writes_nothing()
    {
        using var admin = As("root", AdminRoles);
        var group = (await (await admin.PostAsync("/admin/groups", Json(new { name = "Staff" }))).Content
            .ReadFromJsonAsync<AdminGroupDto>())!;
        await admin.PatchAsync($"/admin/groups/{group.Id}", Json(new { name = "Staff" })); // the same name
        await admin.PutAsync($"/admin/groups/{group.Id}/members/{_users["editor"].Id}", null);
        await admin.PutAsync($"/admin/groups/{group.Id}/members/{_users["editor"].Id}", null); // already in

        (await Audit($"?subject={group.Id}")).Items.Select(e => e.Action)
            .ShouldBe([AuditActions.GroupMemberAdded, AuditActions.GroupCreated]);
    }

    [Test]
    public async Task A_group_getting_and_losing_a_role_in_a_room_is_an_entry_of_the_room()
    {
        using var admin = As("root", AdminRoles);
        var group = (await (await admin.PostAsync("/admin/groups", Json(new { name = "Staff" }))).Content
            .ReadFromJsonAsync<AdminGroupDto>())!;
        using var owner = As("owner");
        await owner.PutAsync($"/rooms/{_room.Id}/groups/{group.Id}", Json(new { role = "Editor" }));
        await owner.DeleteAsync($"/rooms/{_room.Id}/groups/{group.Id}");

        var entries = await History($"/rooms/{_room.Id}/history");

        entries.Select(e => e.Action).ShouldBe([AuditActions.RoomGroupRoleRemoved, AuditActions.RoomGroupRoleSet]);
        entries[1].Details!.Value.GetProperty("groupName").GetString().ShouldBe("Staff");
        entries[1].Details!.Value.GetProperty("role").GetString().ShouldBe("Editor");
    }

    [Test]
    public async Task The_groups_of_the_identity_provider_are_one_entry_per_changed_set_not_per_request()
    {
        using (var first = As("newcomer", null, "g-1", "g-2"))
        {
            await first.GetAsync("/boards");
            await first.GetAsync("/boards"); // the same claim: nothing to write
        }

        using (var second = As("newcomer", null, "g-2", "g-3"))
        {
            await second.GetAsync("/boards");
        }

        var entries = (await Audit($"?subject={_users["newcomer"].Id}")).Items
            .Where(e => e.Action == AuditActions.GroupsSynced)
            .ToList();

        entries.Count.ShouldBe(2);
        entries[1].Details!.Value.GetProperty("added").GetInt32().ShouldBe(2);
        entries[1].Details!.Value.GetProperty("removed").GetInt32().ShouldBe(0);
        entries[0].Details!.Value.GetProperty("added").GetInt32().ShouldBe(1);
        entries[0].Details!.Value.GetProperty("removed").GetInt32().ShouldBe(1);
        entries[0].Actor!.DisplayName.ShouldBe("newcomer");
    }

    // ------------------------------------------------------------ invitations

    [Test]
    public async Task Making_revoking_and_following_a_link_are_entries_of_the_board()
    {
        using var owner = As("owner");
        var made = await owner.PostAsync($"/boards/{_board.Id}/invitations",
            Json(new { role = "Viewer", expiresInHours = 24 }));
        var link = (await made.Content.ReadFromJsonAsync<CreatedInvitationDto>())!;
        using (var newcomer = As("newcomer"))
        {
            (await newcomer.PostAsync($"/invitations/{link.Token}/accept", null)).StatusCode
                .ShouldBe(HttpStatusCode.OK);
        }

        await owner.DeleteAsync($"/boards/{_board.Id}/invitations/{link.Id}");

        var entries = await History($"/boards/{_board.Id}/history");

        entries.Select(e => e.Action)
            .ShouldBe([
                AuditActions.InvitationRevoked, AuditActions.InvitationAccepted, AuditActions.InvitationCreated
            ]);
        entries[1].Actor!.DisplayName.ShouldBe("newcomer");
        // The token is a secret: it is in no entry.
        entries.ShouldAllBe(e => e.Details == null || !e.Details.Value.GetRawText().Contains(link.Token));
    }

    // ------------------------------------------------------------ what an entry holds

    [Test]
    public async Task No_entry_holds_an_email_address()
    {
        using var owner = As("owner");
        await owner.PostAsync($"/boards/{_board.Id}/members",
            Json(new { email = "newcomer@example.com", role = "Viewer" }));
        await owner.PostAsync($"/rooms/{_room.Id}/members",
            Json(new { email = "newcomer@example.com", role = "Viewer" }));

        var all = await InDb(db => db.AuditEntries.ToListAsync());

        all.ShouldNotBeEmpty();
        all.ShouldAllBe(e => e.Details == null || !e.Details.Contains('@'));
    }

    [Test]
    public async Task An_entry_carries_the_request_id_of_the_logs()
    {
        using var owner = As("owner");
        owner.DefaultRequestHeaders.Add("X-Request-Id", "req-12345678");
        await owner.PostAsync($"/boards/{_board.Id}/members",
            Json(new { email = "newcomer@example.com", role = "Viewer" }));

        var entries = await History($"/boards/{_board.Id}/history");

        entries.Single().RequestId.ShouldBe("req-12345678");
    }

    // ------------------------------------------------------------ the admin list

    [Test]
    public async Task Only_an_administrator_reads_the_log_of_the_instance()
    {
        using var owner = As("owner");

        (await owner.GetAsync("/admin/audit")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task The_log_is_filtered_by_subject_actor_and_time_and_paged()
    {
        using var owner = As("owner");
        await owner.PostAsync($"/boards/{_board.Id}/members",
            Json(new { email = "newcomer@example.com", role = "Viewer" }));
        _time.Now = Start.AddDays(1);
        await owner.PostAsync($"/rooms/{_room.Id}/members",
            Json(new { email = "editor@example.com", role = "Editor" }));
        _time.Now = Start.AddDays(2);
        using var admin = As("root", AdminRoles);
        await admin.PostAsync("/admin/groups", Json(new { name = "Staff" }));

        (await Audit()).Total.ShouldBe(3);
        (await Audit($"?subject={_board.Id}")).Items.Single().SubjectType.ShouldBe("board");
        (await Audit($"?actor={_users["owner"].Id}")).Total.ShouldBe(2);
        (await Audit(
                $"?from={Uri.EscapeDataString(Start.AddHours(12).ToString("O"))}&to={Uri.EscapeDataString(Start.AddDays(1.5).ToString("O"))}"))
            .Items.Single()
            .SubjectType.ShouldBe("room");
        var page = await Audit("?pageSize=2&page=2");
        page.Items.Count.ShouldBe(1);
        page.Total.ShouldBe(3);
        (await Audit("")).Items[0].Action.ShouldBe(AuditActions.GroupCreated); // newest first
    }

    // ------------------------------------------------------------ retention

    [Test]
    public async Task The_cleanup_removes_what_is_past_the_retention_and_only_that()
    {
        using var owner = As("owner");
        await owner.PostAsync($"/boards/{_board.Id}/members",
            Json(new { email = "newcomer@example.com", role = "Viewer" }));
        _time.Now = Start.AddDays(200);
        await owner.PostAsync($"/rooms/{_room.Id}/members",
            Json(new { email = "editor@example.com", role = "Editor" }));
        _time.Now = Start.AddDays(366); // the first entry is 366 days old, the second 166
        var service = new AuditRetentionService(_factory.Services.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(new AuditOptions { RetentionDays = 365 }),
            _time,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<AuditRetentionService>.Instance);

        (await service.PurgeAsync(CancellationToken.None)).ShouldBe(1);

        var left = await InDb(db => db.AuditEntries.ToListAsync());
        left.Single().SubjectType.ShouldBe("room");
        (await service.PurgeAsync(CancellationToken.None)).ShouldBe(0);
    }

    [Test]
    public void The_cleanup_runs_at_night_every_day()
    {
        AuditRetentionService.UntilNextRun(new DateTimeOffset(2026, 10, 5, 1, 0, 0, TimeSpan.Zero))
            .ShouldBe(TimeSpan.FromHours(2) + TimeSpan.FromMinutes(17));
        AuditRetentionService.UntilNextRun(new DateTimeOffset(2026, 10, 5, 4, 0, 0, TimeSpan.Zero))
            .ShouldBe(TimeSpan.FromHours(23) + TimeSpan.FromMinutes(17));
    }

    [Test]
    public void The_retention_defaults_to_a_year()
    {
        new AuditOptions().RetentionDays.ShouldBe(365);
    }
}
