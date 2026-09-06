using Elysion.BusinessBackend.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Data;

public class ElysionDbContext(DbContextOptions<ElysionDbContext> options) : DbContext(options)
{
    public DbSet<Board> Boards => Set<Board>();
}
