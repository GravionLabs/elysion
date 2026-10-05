using Elysion.BusinessBackend.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data;

public class ElysionDbContext(DbContextOptions<ElysionDbContext> options) : DbContext(options), IUnitOfWork
{
    public DbSet<Board> Boards => Set<Board>();
    public DbSet<BoardDocument> BoardDocuments => Set<BoardDocument>();
    public DbSet<User> Users => Set<User>();
    public DbSet<BoardMembership> BoardMemberships => Set<BoardMembership>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BoardDocument>(document =>
        {
            document.HasKey(d => d.BoardId);
            document.Property(d => d.BoardId).HasMaxLength(BoardDocument.MaxBoardIdLength);
            // The database rejects an UPDATE whose version moved on, even when two requests race.
            document.Property(d => d.Version).IsConcurrencyToken();
        });

        modelBuilder.Entity<User>(user =>
        {
            user.Property(u => u.Subject).HasMaxLength(User.MaxSubjectLength);
            user.Property(u => u.Email).HasMaxLength(User.MaxEmailLength);
            user.Property(u => u.DisplayName).HasMaxLength(User.MaxDisplayNameLength);
            // The identity provider's id is how a token finds its user: two users cannot share it.
            user.HasIndex(u => u.Subject).IsUnique();
        });

        modelBuilder.Entity<Board>(board =>
            board
                .HasOne(b => b.Owner)
                .WithMany()
                .HasForeignKey(b => b.OwnerId)
                .OnDelete(DeleteBehavior.SetNull));

        modelBuilder.Entity<BoardMembership>(membership =>
        {
            // One role per user per board; the key is the unique index.
            membership.HasKey(m => new { m.BoardId, m.UserId });
            membership.Property(m => m.Role).HasConversion<string>().HasMaxLength(16);
            membership.HasOne(m => m.Board).WithMany(b => b.Memberships).HasForeignKey(m => m.BoardId).OnDelete(DeleteBehavior.Cascade);
            membership.HasOne(m => m.User).WithMany(u => u.Memberships).HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
            // "Which boards can this user open?" starts from the user.
            membership.HasIndex(m => m.UserId);
        });
    }
}
