using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Entities;
using Elysion.BusinessBackend.Api.Webhooks;

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
    public DbSet<BoardSnapshot> BoardSnapshots => Set<BoardSnapshot>();

    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<AccessToken> AccessTokens => Set<AccessToken>();
    public DbSet<WebhookEndpoint> WebhookEndpoints => Set<WebhookEndpoint>();
    public DbSet<WebhookDelivery> WebhookDeliveries => Set<WebhookDelivery>();

    public void DiscardChanges() => ChangeTracker.Clear();
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMembership> GroupMemberships => Set<GroupMembership>();
    public DbSet<PendingGroupMembership> PendingGroupMemberships => Set<PendingGroupMembership>();
    public DbSet<RoomGroupMembership> RoomGroupMemberships => Set<RoomGroupMembership>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AuditEntry>(entry =>
        {
            entry.Property(e => e.Action).HasMaxLength(AuditEntry.MaxActionLength);
            entry.Property(e => e.SubjectType).HasMaxLength(AuditEntry.MaxSubjectTypeLength);
            entry.Property(e => e.Details).HasMaxLength(AuditEntry.MaxDetailsLength);
            entry.Property(e => e.RequestId).HasMaxLength(AuditEntry.MaxRequestIdLength);
            // "What happened to this board" and "what did this person do", newest first; the date alone serves the filter and the cleanup.
            entry.HasIndex(e => new { e.SubjectType, e.SubjectId, e.At });
            entry.HasIndex(e => new { e.ActorUserId, e.At });
            entry.HasIndex(e => e.At);
        });

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

        modelBuilder.Entity<PendingGroupMembership>(pending =>
        {
            pending.Property(p => p.Email).HasMaxLength(User.MaxEmailLength);
            pending.Property(p => p.DisplayName).HasMaxLength(User.MaxDisplayNameLength);
            pending.Property(p => p.ObjectId).HasMaxLength(PendingGroupMembership.MaxObjectIdLength);
            pending.HasOne(p => p.Group).WithMany().HasForeignKey(p => p.GroupId).OnDelete(DeleteBehavior.Cascade);
            // One entry per person and group; the first sign-in looks the person up by their address.
            pending.HasIndex(p => new { p.GroupId, p.Email }).IsUnique();
            pending.HasIndex(p => p.Email);
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

        modelBuilder.Entity<BoardSnapshot>(snapshot =>
        {
            snapshot.Property(s => s.Name).HasMaxLength(BoardSnapshot.MaxNameLength);
            snapshot.Property(s => s.Kind).HasConversion<string>().HasMaxLength(16);
            snapshot.Property(s => s.CreatedBy).HasMaxLength(User.MaxSubjectLength);
            // Snapshots go with their board (ADR 0032); "the history of this board, newest first" starts from the board.
            snapshot.HasOne(s => s.Board).WithMany().HasForeignKey(s => s.BoardId).OnDelete(DeleteBehavior.Cascade);
            snapshot.HasIndex(s => new { s.BoardId, s.CreatedAt });
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

        modelBuilder.Entity<AccessToken>(token =>
        {
            token.Property(t => t.Name).HasMaxLength(AccessToken.MaxNameLength);
            token.Property(t => t.Prefix).HasMaxLength(AccessTokenSecrets.DisplayLength);
            token.Property(t => t.Hash).HasMaxLength(64);
            token.Property(t => t.Scopes).HasMaxLength(200);
            // A request finds its token by the hash of the secret: two tokens cannot share it.
            token.HasIndex(t => t.Hash).IsUnique();
            token.HasIndex(t => t.OwnerId);
            token.HasOne(t => t.Owner).WithMany().HasForeignKey(t => t.OwnerId).OnDelete(DeleteBehavior.Cascade);
            token.Ignore(t => t.ScopeList);
        });

        modelBuilder.Entity<WebhookEndpoint>(endpoint =>
        {
            endpoint.Property(e => e.Url).HasMaxLength(WebhookEndpoint.MaxUrlLength);
            endpoint.Property(e => e.Events).HasMaxLength(400);
            endpoint.Property(e => e.Secret).HasMaxLength(WebhookSecrets.Length);
            endpoint.Property(e => e.DisabledReason).HasMaxLength(WebhookEndpoint.MaxReasonLength);
            // No foreign key to the board (see WebhookEndpoint): "who hears about this board" starts from the board.
            endpoint.HasIndex(e => e.BoardId);
            endpoint.Ignore(e => e.EventList);
        });

        modelBuilder.Entity<WebhookDelivery>(delivery =>
        {
            delivery.Property(d => d.EventType).HasMaxLength(WebhookDelivery.MaxEventTypeLength);
            delivery.Property(d => d.Status).HasConversion<string>().HasMaxLength(16);
            delivery.Property(d => d.Error).HasMaxLength(WebhookDelivery.MaxErrorLength);
            // Two instances that take the same row: the second UPDATE finds another token and fails.
            delivery.Property(d => d.LeaseToken).IsConcurrencyToken();
            delivery.HasOne(d => d.Endpoint)
                .WithMany()
                .HasForeignKey(d => d.EndpointId)
                .OnDelete(DeleteBehavior.Cascade);
            // The worker's question ("what is due?"), the list of an endpoint, and the once-a-minute check of a board.
            delivery.HasIndex(d => new { d.Status, d.NextAttemptAt });
            delivery.HasIndex(d => new { d.EndpointId, d.CreatedAt });
            delivery.HasIndex(d => new { d.BoardId, d.EventType, d.CreatedAt });
        });

        // "Which boards are in this room?" starts from the room.
        modelBuilder.Entity<Board>().HasIndex(b => b.RoomId);
    }
}
