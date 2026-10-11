using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elysion.BusinessBackend.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGraphSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "GraphSyncedAt",
                table: "Groups",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NameFromProvider",
                table: "Groups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "FromGraph",
                table: "GroupMemberships",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "PendingGroupMemberships",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ObjectId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PendingGroupMemberships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PendingGroupMemberships_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PendingGroupMemberships_Email",
                table: "PendingGroupMemberships",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_PendingGroupMemberships_GroupId_Email",
                table: "PendingGroupMemberships",
                columns: new[] { "GroupId", "Email" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PendingGroupMemberships");

            migrationBuilder.DropColumn(
                name: "GraphSyncedAt",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "NameFromProvider",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "FromGraph",
                table: "GroupMemberships");
        }
    }
}
