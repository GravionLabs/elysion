using Elysion.BusinessBackend.Api.Entities;

using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data;

public class ElysionDbContext(DbContextOptions<ElysionDbContext> options) : DbContext(options), IUnitOfWork
{
    public DbSet<Board> Boards => Set<Board>();
    public DbSet<BoardDocument> BoardDocuments => Set<BoardDocument>();
    public DbSet<User> Users => Set<User>();
    public DbSet<BoardMembership> BoardMemberships => Set<BoardMembership>();
    public DbSet<Template> Templates => Set<Template>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<RoomMembership> RoomMemberships => Set<RoomMembership>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BoardDocument>(document =>
        {
            document.HasKey(d => d.BoardId);
            document.Property(d => d.BoardId).HasMaxLength(BoardDocument.MaxBoardIdLength);
            // The database rejects an UPDATE whose version moved on, even when two requests race.
            document.Property(d => d.Version).IsConcurrencyToken();
        });

        modelBuilder.Entity<Template>(template =>
        {
            template.Property(t => t.Name).HasMaxLength(Template.MaxNameLength);
            template.Property(t => t.Description).HasMaxLength(Template.MaxDescriptionLength);
            // A user's templates go with the user; "which templates can this user see?" starts from the owner.
            template.HasOne(t => t.Owner).WithMany().HasForeignKey(t => t.OwnerId).OnDelete(DeleteBehavior.Cascade);
            template.HasData(BuiltInTemplates.All());
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
            membership.HasOne(m => m.Board)
                .WithMany(b => b.Memberships)
                .HasForeignKey(m => m.BoardId)
                .OnDelete(DeleteBehavior.Cascade);
            membership.HasOne(m => m.User)
                .WithMany(u => u.Memberships)
                .HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            // "Which boards can this user open?" starts from the user.
            membership.HasIndex(m => m.UserId);
        });

        modelBuilder.Entity<Room>(room =>
        {
            room.Property(r => r.Name).HasMaxLength(Room.MaxNameLength);
            // A room does not go with its creator; it is left without one, like a board.
            room.HasOne(r => r.Owner).WithMany().HasForeignKey(r => r.OwnerId).OnDelete(DeleteBehavior.SetNull);
            // The boards stay when their room is deleted: they leave it.
            room.HasMany(r => r.Boards)
                .WithOne(b => b.Room)
                .HasForeignKey(b => b.RoomId)
                .OnDelete(DeleteBehavior.SetNull);
            // "Which rooms can this user see?" starts from the owner.
            room.HasIndex(r => r.OwnerId);
        });

        modelBuilder.Entity<RoomMembership>(membership =>
        {
            membership.HasKey(m => new { m.RoomId, m.UserId });
            membership.Property(m => m.Role).HasConversion<string>().HasMaxLength(16);
            membership.HasOne(m => m.Room)
                .WithMany(r => r.Memberships)
                .HasForeignKey(m => m.RoomId)
                .OnDelete(DeleteBehavior.Cascade);
            membership.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
            // "Which rooms is this user a member of?" starts from the user.
            membership.HasIndex(m => m.UserId);
        });

        // "Which boards are in this room?" starts from the room.
        modelBuilder.Entity<Board>().HasIndex(b => b.RoomId);
    }
}
