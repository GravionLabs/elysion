using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Webhooks;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Webhooks;

/// <summary>The outbox on a relational database (SQLite): a lease is taken by one instance only, and a deleted endpoint takes its deliveries.</summary>
public class WebhookRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly CancellationToken Ct = CancellationToken.None;

    private SqliteDatabase _database = null!;
    private WebhookEndpoint _endpoint = null!;
    private WebhookDelivery _delivery = null!;

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        _endpoint = WebhookEndpoint.Create(Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            "https://hooks.example.com",
            [],
            WebhookSecrets.Generate(),
            null,
            Now);
        _delivery = new WebhookDelivery
        {
            Id = Guid.CreateVersion7(),
            EndpointId = _endpoint.Id,
            EventId = Guid.CreateVersion7(),
            EventType = WebhookEventTypes.BoardRenamed,
            BoardId = _endpoint.BoardId,
            Payload = "{}",
            Status = WebhookDeliveryStatus.Pending,
            CreatedAt = Now,
            NextAttemptAt = Now,
            LeaseToken = Guid.NewGuid(),
        };
        await using var db = _database.NewContext();
        db.AddRange(_endpoint, _delivery);
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    [Test]
    public async Task Two_instances_that_see_the_same_due_row_cannot_both_take_it()
    {
        await using var first = _database.NewContext();
        await using var second = _database.NewContext();
        var mine = (await new WebhookRepository(first).ListDueAsync(Now, 10, Ct)).ShouldHaveSingleItem();
        var theirs = (await new WebhookRepository(second).ListDueAsync(Now, 10, Ct)).ShouldHaveSingleItem();

        (await new WebhookRepository(first).TryLeaseAsync(mine, Now.AddMinutes(2), Ct)).ShouldBeTrue();
        (await new WebhookRepository(second).TryLeaseAsync(theirs, Now.AddMinutes(2), Ct)).ShouldBeFalse();

        await using var third = _database.NewContext();
        (await new WebhookRepository(third).ListDueAsync(Now.AddMinutes(1), 10, Ct)).ShouldBeEmpty();
        (await new WebhookRepository(third).ListDueAsync(Now.AddMinutes(3), 10, Ct)).ShouldHaveSingleItem();
    }

    [Test]
    public async Task A_switched_off_endpoint_has_nothing_due()
    {
        await using (var db = _database.NewContext())
        {
            db.Attach(_endpoint);
            _endpoint.DisabledAt = Now;
            await db.SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        (await new WebhookRepository(read).ListDueAsync(Now, 10, Ct)).ShouldBeEmpty();
        (await new WebhookRepository(read).CountPendingAsync(Ct)).ShouldBe(1);
    }

    [Test]
    public async Task Deleting_an_endpoint_deletes_its_deliveries()
    {
        await using (var db = _database.NewContext())
        {
            var repository = new WebhookRepository(db);
            repository.Remove((await repository.FindForUpdateAsync(_endpoint.BoardId, _endpoint.Id, Ct))!);
            await db.SaveChangesAsync();
        }

        await using var read = _database.NewContext();
        (await new WebhookRepository(read).CountPendingAsync(Ct)).ShouldBe(0);
    }

    [Test]
    public async Task An_endpoint_is_found_only_where_it_belongs()
    {
        await using var db = _database.NewContext();
        var repository = new WebhookRepository(db);

        (await repository.FindForUpdateAsync(_endpoint.BoardId, _endpoint.Id, Ct)).ShouldNotBeNull();
        (await repository.FindForUpdateAsync(null, _endpoint.Id, Ct)).ShouldBeNull();
        (await repository.FindForUpdateAsync(Guid.CreateVersion7(), _endpoint.Id, Ct)).ShouldBeNull();
    }

    [Test]
    public async Task The_once_a_minute_check_looks_at_the_board_and_the_event_type()
    {
        await using var db = _database.NewContext();
        var repository = new WebhookRepository(db);

        (await repository.HasEventSinceAsync(_endpoint.BoardId!.Value,
                WebhookEventTypes.BoardRenamed,
                Now.AddSeconds(-1),
                Ct))
            .ShouldBeTrue();
        (await repository.HasEventSinceAsync(_endpoint.BoardId.Value, WebhookEventTypes.BoardRenamed, Now, Ct))
            .ShouldBeFalse();
        (await repository.HasEventSinceAsync(_endpoint.BoardId.Value,
                WebhookEventTypes.BoardContentChanged,
                Now.AddSeconds(-1),
                Ct))
            .ShouldBeFalse();
    }
}
