using ModelContextProtocol.Server;
using System.ComponentModel;

[McpServerToolType]
public class MyTools
{
    [McpServerTool, Description("Returns a greeting for the given name.")]
    public static string Greet(
        [Description("The name to greet.")] string name)
        => $"Hello, {name}!";

    [McpServerTool, Description("Adds two integers and returns the sum.")]
    public static async Task<string> Add(
        [Description("First operand.")] int a,
        [Description("Second operand.")] int b,
        CancellationToken cancellationToken)
    {
        await Task.Delay(0, cancellationToken); // replace with actual async work
        return $"{a} + {b} = {a + b}";
    }
}
