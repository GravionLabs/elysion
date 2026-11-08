using ModelContextProtocol.Server;
using ModelContextProtocol.Protocol;
using System.ComponentModel;

[McpServerPromptType]
public class MyPrompts
{
    [McpServerPrompt, Description("Generates a code review prompt for the given code snippet.")]
    public static PromptMessage ReviewCode(
        [Description("The code snippet to review.")] string code,
        [Description("Programming language of the snippet.")] string language = "C#")
    {
        static string NormalizeFenceLanguage(string value)
        {
            var normalized = value.Trim();

            return normalized switch
            {
                "C#" => "csharp",
                "F#" => "fsharp",
                "C++" => "cpp",
                _ => normalized.ToLowerInvariant()
            };
        }

        static string SanitizeCodeBlockContent(string value) =>
            value.Replace("```", "``\u200B`");

        var fenceLanguage = NormalizeFenceLanguage(language);
        var sanitizedCode = SanitizeCodeBlockContent(code);

        return new PromptMessage
        {
            Role = Role.User,
            Content = new TextContentBlock
            {
                Text = $"Please review the following {language} code and suggest improvements:\n\n```{fenceLanguage}\n{sanitizedCode}\n```"
            }
        };
    }
}
