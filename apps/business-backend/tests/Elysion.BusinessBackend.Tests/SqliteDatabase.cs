using Elysion.BusinessBackend.Api.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Tests;

/// <summary>
/// A SQLite database in memory with the real model, for tests of the repositories: SQLite is relational (unique
/// indexes, foreign keys, concurrency tokens work), which the EF in-memory provider is not. It lives as long as this
/// object. SQLite cannot order by <see cref="DateTimeOffset"/>, so the test context stores it as a number
/// (ADR 0015); the production model on Postgres is unchanged.
/// </summary>
public sealed class SqliteDatabase : IDisposable
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:;Foreign Keys=True");

    public SqliteDatabase()
    {
        _connection.Open();
        using var context = NewContext();
        context.Database.EnsureCreated();
    }

    /// <summary>A new context on the same database, as a new request would have.</summary>
    public ElysionDbContext NewContext() =>
        new SqliteElysionDbContext(new DbContextOptionsBuilder<ElysionDbContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();

    private sealed class SqliteElysionDbContext(DbContextOptions<ElysionDbContext> options) : ElysionDbContext(options)
    {
        protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
            configurationBuilder.Properties<DateTimeOffset>().HaveConversion<long>();
    }
}
