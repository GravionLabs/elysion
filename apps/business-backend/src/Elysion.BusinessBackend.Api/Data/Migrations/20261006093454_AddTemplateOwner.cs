using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elysion.BusinessBackend.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTemplateOwner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "OwnerId",
                table: "Templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id",
                keyValue: new Guid("0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b01"),
                column: "OwnerId",
                value: null);

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id",
                keyValue: new Guid("0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b02"),
                column: "OwnerId",
                value: null);

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id",
                keyValue: new Guid("0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b03"),
                column: "OwnerId",
                value: null);

            migrationBuilder.CreateIndex(
                name: "IX_Templates_OwnerId",
                table: "Templates",
                column: "OwnerId");

            migrationBuilder.AddForeignKey(
                name: "FK_Templates_Users_OwnerId",
                table: "Templates",
                column: "OwnerId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Templates_Users_OwnerId",
                table: "Templates");

            migrationBuilder.DropIndex(
                name: "IX_Templates_OwnerId",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "OwnerId",
                table: "Templates");
        }
    }
}
