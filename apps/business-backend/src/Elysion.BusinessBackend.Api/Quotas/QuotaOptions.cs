using System.ComponentModel.DataAnnotations;

namespace Elysion.BusinessBackend.Api.Quotas;

/// <summary>
/// What one person may keep (finding F6, #777): without a limit one account could store boards and templates until the
/// database is full. A request over a quota is answered <c>409</c> with a problem that says which. Bound from configuration
/// under the names the other settings use.
/// </summary>
public sealed class QuotaOptions
{
    public const string MaxTemplatesSetting = "MAX_TEMPLATES_PER_USER";
    public const string MaxTemplateCharactersSetting = "MAX_TEMPLATE_CHARACTERS_PER_USER";
    public const string MaxBoardsSetting = "MAX_BOARDS_PER_USER";

    public const int DefaultMaxTemplates = 100;
    public const long DefaultMaxTemplateCharacters = 20_000_000;
    public const int DefaultMaxBoards = 1000;

    /// <summary>How many templates of their own a person may have.</summary>
    [Range(1, 1_000_000)]
    public int MaxTemplates { get; set; } = DefaultMaxTemplates;

    /// <summary>The scenes of a person's own templates together, in characters (one scene is at most 5,000,000).</summary>
    [Range(1, 10_000_000_000)]
    public long MaxTemplateCharacters { get; set; } = DefaultMaxTemplateCharacters;

    /// <summary>How many boards a person may own (boards shared with them do not count).</summary>
    [Range(1, 1_000_000)]
    public int MaxBoards { get; set; } = DefaultMaxBoards;
}
