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
    private readonly SqliteConnection? _connection;
    private readonly string? _file;

    /// <param name="concurrent">
    /// <c>false</c> (the default): one connection in memory, shared by all contexts, which is only safe when the
    /// contexts are not used at the same time. <c>true</c>: a temporary file where every context has a connection
    /// of its own, for tests that really run requests in parallel (a SQLite connection is not thread-safe).
    /// </param>
    public SqliteDatabase(bool concurrent = false)
    {
        if (concurrent)
        {
            _file = Path.Combine(Path.GetTempPath(), $"elysion-test-{Guid.NewGuid():N}.db");
        }
        else
        {
            _connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=True");
            _connection.Open(); // the database lives as long as this connection
        }

        using var context = NewContext();
        context.Database.EnsureCreated();
    }

    /// <summary>A new context on the same database, as a new request would have.</summary>
    public ElysionDbContext NewContext()
    {
        var builder = new DbContextOptionsBuilder<ElysionDbContext>();
        _ = _connection is not null
            ? builder.UseSqlite(_connection)
            : builder.UseSqlite($"Data Source={_file};Foreign Keys=True;Pooling=False");
        return new SqliteElysionDbContext(builder.Options);
    }

    public void Dispose()
    {
        _connection?.Dispose();
        if (_file is not null)
        {
            SqliteConnection.ClearAllPools();
            foreach (var path in new[] { _file, _file + "-wal", _file + "-shm", _file + "-journal" })
            {
                File.Delete(path);
            }
        }
    }

    private sealed class SqliteElysionDbContext(DbContextOptions<ElysionDbContext> options) : ElysionDbContext(options)
    {
        protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
            configurationBuilder.Properties<DateTimeOffset>().HaveConversion<long>();
    }
}
