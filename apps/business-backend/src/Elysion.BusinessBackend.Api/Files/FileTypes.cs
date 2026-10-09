namespace Elysion.BusinessBackend.Api.Files;

/// <summary>
/// The image types a board may hold, recognized by their first bytes (a header can say anything). SVG is
/// refused on purpose: it is a document that can carry script, and the canvas can draw the four raster formats.
/// </summary>
public static class FileTypes
{
    public const string Png = "image/png";
    public const string Jpeg = "image/jpeg";
    public const string Gif = "image/gif";
    public const string WebP = "image/webp";

    public static bool IsAllowed(string? contentType) =>
        contentType is Png or Jpeg or Gif or WebP;

    /// <summary>The type the bytes are, or <c>null</c> when they are none of the allowed ones.</summary>
    public static string? Sniff(ReadOnlySpan<byte> bytes)
    {
        if (bytes.StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            return Png;
        }

        if (bytes.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }))
        {
            return Jpeg;
        }

        if (bytes.StartsWith("GIF87a"u8) || bytes.StartsWith("GIF89a"u8))
        {
            return Gif;
        }

        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return WebP;
        }

        return null;
    }

    /// <summary>The id Excalidraw gives a file (a content hash); anything made of these characters, 8 to 64 long, is accepted.</summary>
    public static bool IsValidFileId(string id) =>
        id.Length is >= 8 and <= 64 && id.All(c =>
            c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '-' or '_');

    public static string Prefix(Guid boardId) => $"boards/{boardId}/";
}
