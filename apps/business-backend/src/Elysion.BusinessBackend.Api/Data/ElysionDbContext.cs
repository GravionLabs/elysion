using Elysion.BusinessBackend.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data;

public class ElysionDbContext(DbContextOptions<ElysionDbContext> options) : DbContext(options)
{
    public DbSet<Board> Boards => Set<Board>();
    public DbSet<BoardDocument> BoardDocuments => Set<BoardDocument>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.Entity<BoardDocument>(document =>
        {
            document.HasKey(d => d.BoardId);
            document.Property(d => d.BoardId).HasMaxLength(BoardDocument.MaxBoardIdLength);
            // The database rejects an UPDATE whose version moved on, even when two requests race.
            document.Property(d => d.Version).IsConcurrencyToken();
        });
}
