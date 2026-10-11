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
    public DbSet<BoardVisit> BoardVisits => Set<BoardVisit>();
    public DbSet<BoardFavorite> BoardFavorites => Set<BoardFavorite>();
    public DbSet<VotingSession> VotingSessions => Set<VotingSession>();

    public DbSet<Invitation> Invitations => Set<Invitation>();

    public void DiscardChanges() => ChangeTracker.Clear();
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMembership> GroupMemberships => Set<GroupMembership>();
    public DbSet<RoomGroupMembership> RoomGroupMemberships => Set<RoomGroupMembership>();

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

        modelBuilder.Entity<Group>(group =>
        {
            group.Property(g => g.Name).HasMaxLength(Group.MaxNameLength);
            group.Property(g => g.ExternalId).HasMaxLength(Group.MaxExternalIdLength);
            group.Property(g => g.Source).HasConversion<string>().HasMaxLength(24);
            // A linked group is found by what the provider calls it; a local group has none (a filter keeps every NULL apart).
            group.HasIndex(g => g.ExternalId)
                .IsUnique()
                .HasFilter("\"ExternalId\" IS NOT NULL")
                .HasDatabaseName("IX_Groups_ExternalId");
            group.HasIndex(g => g.Name);
        });

        modelBuilder.Entity<GroupMembership>(membership =>
        {
            membership.HasKey(m => new { m.GroupId, m.UserId });
            membership.HasOne(m => m.Group)
                .WithMany(g => g.Memberships)
                .HasForeignKey(m => m.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
            membership.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
            // "Which groups is this user in?" starts from the user: it runs for every board list.
            membership.HasIndex(m => m.UserId);
        });

        modelBuilder.Entity<RoomGroupMembership>(membership =>
        {
            membership.HasKey(m => new { m.RoomId, m.GroupId });
            membership.Property(m => m.Role).HasConversion<string>().HasMaxLength(16);
            membership.HasOne(m => m.Room).WithMany().HasForeignKey(m => m.RoomId).OnDelete(DeleteBehavior.Cascade);
            membership.HasOne(m => m.Group).WithMany().HasForeignKey(m => m.GroupId).OnDelete(DeleteBehavior.Cascade);
            membership.HasIndex(m => m.GroupId);
        });

        modelBuilder.Entity<BoardVisit>(visit =>
        {
            visit.HasKey(v => new { v.BoardId, v.UserId });
            visit.HasOne(v => v.Board).WithMany().HasForeignKey(v => v.BoardId).OnDelete(DeleteBehavior.Cascade);
            visit.HasOne(v => v.User).WithMany().HasForeignKey(v => v.UserId).OnDelete(DeleteBehavior.Cascade);
            // "What did this user open lately?" starts from the user.
            visit.HasIndex(v => v.UserId);
        });

        modelBuilder.Entity<BoardFavorite>(favorite =>
        {
            favorite.HasKey(f => new { f.BoardId, f.UserId });
            favorite.HasOne(f => f.Board).WithMany().HasForeignKey(f => f.BoardId).OnDelete(DeleteBehavior.Cascade);
            favorite.HasOne(f => f.User).WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
            favorite.HasIndex(f => f.UserId);
        });

        modelBuilder.Entity<VotingSession>(session =>
        {
            session.Property(s => s.Name).HasMaxLength(VotingSession.MaxNameLength);
            session.Property(s => s.StartedBySubject).HasMaxLength(User.MaxSubjectLength);
            session.Property(s => s.StartedByName).HasMaxLength(User.MaxDisplayNameLength);
            session.HasOne(s => s.Board).WithMany().HasForeignKey(s => s.BoardId).OnDelete(DeleteBehavior.Cascade);
            session.HasIndex(s => s.BoardId);
            // One open voting per board, even when two starts race (Open = 0).
            session.HasIndex(s => s.BoardId)
                .IsUnique()
                .HasFilter("\"Status\" = 0")
                .HasDatabaseName("IX_VotingSessions_OneOpenPerBoard");
        });

        modelBuilder.Entity<Vote>(vote =>
        {
            vote.Property(v => v.ElementId).HasMaxLength(VotingSession.MaxElementIdLength);
            vote.HasOne(v => v.VotingSession)
                .WithMany(s => s.Votes)
                .HasForeignKey(v => v.VotingSessionId)
                .OnDelete(DeleteBehavior.Cascade);
            vote.HasOne(v => v.User).WithMany().HasForeignKey(v => v.UserId).OnDelete(DeleteBehavior.Cascade);
            vote.HasIndex(v => new { v.VotingSessionId, v.UserId });
        });

        modelBuilder.Entity<Invitation>(invitation =>
        {
            invitation.Property(i => i.TokenHash).HasMaxLength(64);
            invitation.HasIndex(i => i.TokenHash).IsUnique();
            invitation.Property(i => i.Role).HasConversion<string>().HasMaxLength(16);
            invitation.Property(i => i.Uses).IsConcurrencyToken();
            invitation.HasOne(i => i.Board).WithMany().HasForeignKey(i => i.BoardId).OnDelete(DeleteBehavior.Cascade);
            invitation.HasOne(i => i.Room).WithMany().HasForeignKey(i => i.RoomId).OnDelete(DeleteBehavior.Cascade);
            invitation.HasIndex(i => i.BoardId);
            invitation.HasIndex(i => i.RoomId);
            invitation.ToTable(t => t.HasCheckConstraint("CK_Invitations_OneTarget",
                "(\"BoardId\" IS NULL) <> (\"RoomId\" IS NULL)"));
        });

        // "Which boards are in this room?" starts from the room.
        modelBuilder.Entity<Board>().HasIndex(b => b.RoomId);
    }
}
