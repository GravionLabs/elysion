using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Elysion.BusinessBackend.Api.Controllers;

/// <summary>
/// Board CRUD. There is no owner or authorization yet (users and policies come with the identity
/// epic), so every caller sees every board. Reached through the BFF only.
/// </summary>
[ApiController]
[Route("boards")]
public class BoardsController(ElysionDbContext db, TimeProvider time) : ControllerBase
{
    public const int MaxNameLength = 120;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<BoardDto>>> List(CancellationToken cancellationToken)
    {
        var boards = await db.Boards
            .AsNoTracking()
            .OrderByDescending(board => board.CreatedAt)
            .ToListAsync(cancellationToken);
        return boards.Select(BoardDto.From).ToList();
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<BoardDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var board = await db.Boards.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        return board is null ? NotFound() : BoardDto.From(board);
    }

    [HttpPost]
    public async Task<ActionResult<BoardDto>> Create(BoardNameRequest request, CancellationToken cancellationToken)
    {
        if (!TryNormalizeName(request.Name, out var name))
        {
            return InvalidName();
        }

        var board = new Board { Id = Guid.CreateVersion7(), Name = name, CreatedAt = TruncateToMicroseconds(time.GetUtcNow()) };
        db.Boards.Add(board);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = board.Id }, BoardDto.From(board));
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<BoardDto>> Rename(Guid id, BoardNameRequest request, CancellationToken cancellationToken)
    {
        if (!TryNormalizeName(request.Name, out var name))
        {
            return InvalidName();
        }

        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (board is null)
        {
            return NotFound();
        }

        board.Name = name;
        await db.SaveChangesAsync(cancellationToken);
        return BoardDto.From(board);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (board is null)
        {
            return NotFound();
        }

        db.Boards.Remove(board);
        // The canvas content goes with the board (ADR 0011).
        var document = await db.BoardDocuments.FirstOrDefaultAsync(d => d.BoardId == id.ToString(), cancellationToken);
        if (document is not null)
        {
            db.BoardDocuments.Remove(document);
        }

        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    // Postgres keeps microseconds; without this the response to the create would show more digits than
    // every later read of the same board.
    private static DateTimeOffset TruncateToMicroseconds(DateTimeOffset value) =>
        new(value.Ticks - value.Ticks % 10, value.Offset);

    private static bool TryNormalizeName(string? raw, out string name)
    {
        name = raw?.Trim() ?? string.Empty;
        return name.Length is >= 1 and <= MaxNameLength;
    }

    private ActionResult InvalidName()
    {
        ModelState.AddModelError("name", $"The name must be between 1 and {MaxNameLength} characters.");
        return ValidationProblem(ModelState);
    }
}
