using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elysion.BusinessBackend.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveOrphanedBoardDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A document whose board was deleted (a room saved it after the delete, #778). Ids that are not UUIDs (the demo room
            // `default`) never had a board row and stay.
            migrationBuilder.Sql("""
                DELETE FROM "BoardDocuments" d
                WHERE d."BoardId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  AND NOT EXISTS (SELECT 1 FROM "Boards" b WHERE b."Id"::text = d."BoardId");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
