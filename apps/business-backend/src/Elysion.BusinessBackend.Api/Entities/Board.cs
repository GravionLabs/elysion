namespace Elysion.BusinessBackend.Api.Entities;

public class Board
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
