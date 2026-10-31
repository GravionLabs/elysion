using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.AccessTokens;

/// <summary>What a relational database enforces and answers for personal access tokens (#851).</summary>
public class AccessTokenRepositoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 12, 0, 0, TimeSpan.Zero);

    private SqliteDatabase _database = null!;
    private readonly User _ada = User.Create(Guid.CreateVersion7(), "kc-ada", "Ada", null, Now);
    private readonly User _bob = User.Create(Guid.CreateVersion7(), "kc-bob", "Bob", null, Now);

    [SetUp]
    public async Task SetUp()
    {
        _database = new SqliteDatabase();
        await using var db = _database.NewContext();
        db.AddRange(_ada, _bob);
        await db.SaveChangesAsync();
    }

    [TearDown]
    public void TearDown() => _database.Dispose();

    private static AccessToken New(User owner,
        string secret,
        string name = "Token",
        DateTimeOffset? createdAt = null,
        int days = 30) =>
        AccessToken.Create(Guid.CreateVersion7(),
            owner.Id,
            name,
            secret[..AccessTokenSecrets.DisplayLength],
            AccessTokenSecrets.Hash(secret),
            [AccessTokenScopes.BoardsWrite, AccessTokenScopes.BoardsRead],
            createdAt ?? Now,
            (createdAt ?? Now).AddDays(days));

    private async Task AddAsync(params AccessToken[] tokens)
    {
        await using var db = _database.NewContext();
        var repository = new AccessTokenRepository(db);
        foreach (var token in tokens)
        {
            repository.Add(token);
        }

        await db.SaveChangesAsync();
    }

    [Test]
    public async Task The_grant_of_a_hash_names_the_owners_subject_and_the_scopes()
    {
        var secret = AccessTokenSecrets.Generate();
        var token = New(_ada, secret);
        await AddAsync(token);

        await using var db = _database.NewContext();
        var grant = await new AccessTokenRepository(db).FindGrantByHashAsync(AccessTokenSecrets.Hash(secret), default);

        grant.ShouldNotBeNull();
        grant.Id.ShouldBe(token.Id);
        grant.OwnerId.ShouldBe(_ada.Id);
        grant.OwnerSubject.ShouldBe("kc-ada");
        grant.Scopes.ShouldBe([AccessTokenScopes.BoardsRead, AccessTokenScopes.BoardsWrite]);
        grant.ExpiresAt.ShouldBe(Now.AddDays(30));
        grant.RevokedAt.ShouldBeNull();
        (await new AccessTokenRepository(db).FindGrantByHashAsync(AccessTokenSecrets.Hash("elp_other"), default))
            .ShouldBeNull();
    }

    [Test]
    public async Task Two_tokens_cannot_share_a_hash()
    {
        var secret = AccessTokenSecrets.Generate();
        await AddAsync(New(_ada, secret));

        await Should.ThrowAsync<DbUpdateException>(() => AddAsync(New(_bob, secret)));
    }

    [Test]
    public async Task The_tokens_go_with_their_owner()
    {
        await AddAsync(New(_ada, AccessTokenSecrets.Generate()), New(_bob, AccessTokenSecrets.Generate()));

        await using (var db = _database.NewContext())
        {
            db.Users.Remove(await db.Users.SingleAsync(u => u.Id == _ada.Id));
            await db.SaveChangesAsync();
        }

        await using var check = _database.NewContext();
        (await check.AccessTokens.Select(t => t.OwnerId).ToListAsync()).ShouldBe([_bob.Id]);
    }

    [Test]
    public async Task A_persons_list_is_theirs_newest_first_without_the_revoked_ones()
    {
        var old = New(_ada, AccessTokenSecrets.Generate(), "old", Now.AddDays(-10));
        var expired = New(_ada, AccessTokenSecrets.Generate(), "expired", Now.AddDays(-40));
        var revoked = New(_ada, AccessTokenSecrets.Generate(), "revoked");
        revoked.RevokedAt = Now;
        var fresh = New(_ada, AccessTokenSecrets.Generate(), "fresh");
        await AddAsync(old, expired, revoked, fresh, New(_bob, AccessTokenSecrets.Generate(), "bob's"));

        await using var db = _database.NewContext();
        var repository = new AccessTokenRepository(db);
        var list = await repository.ListForOwnerAsync(_ada.Id, default);

        list.Select(t => t.Name).ShouldBe(["fresh", "old", "expired"]);
        (await repository.CountActiveAsync(_ada.Id, Now, default)).ShouldBe(2);
    }

    [Test]
    public async Task Marking_a_use_writes_the_time()
    {
        var token = New(_ada, AccessTokenSecrets.Generate());
        await AddAsync(token);

        await using (var db = _database.NewContext())
        {
            await new AccessTokenRepository(db).MarkUsedAsync(token.Id, Now.AddHours(1), default);
        }

        await using var check = _database.NewContext();
        (await check.AccessTokens.SingleAsync()).LastUsedAt.ShouldBe(Now.AddHours(1));
    }

    [Test]
    public async Task The_administration_lists_every_token_with_its_owner_and_finds_by_name_prefix_or_owner()
    {
        var adaSecret = AccessTokenSecrets.Generate();
        await AddAsync(New(_ada, adaSecret, "Export", Now.AddMinutes(-1)),
            New(_bob, AccessTokenSecrets.Generate(), "Sync"));

        await using var db = _database.NewContext();
        var repository = new AccessTokenRepository(db);
        var all = await repository.ListAllAsync(null, 1, 10, default);
        var byOwner = await repository.ListAllAsync("ADA", 1, 10, default);
        var byPrefix = await repository.ListAllAsync(adaSecret[..12], 1, 10, default);
        var secondPage = await repository.ListAllAsync(null, 2, 1, default);

        all.Total.ShouldBe(2);
        all.Items.Select(t => (t.Name, t.Owner.DisplayName)).ShouldBe([("Sync", "Bob"), ("Export", "Ada")]);
        byOwner.Items.Select(t => t.Name).ShouldBe(["Export"]);
        byPrefix.Items.Select(t => t.Name).ShouldBe(["Export"]);
        secondPage.Items.Select(t => t.Name).ShouldBe(["Export"]);
        secondPage.Total.ShouldBe(2);
    }
}
