using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

using Microsoft.Extensions.Options;

namespace Elysion.BusinessBackend.Api.Graph;

/// <summary>
/// Microsoft Graph over HTTP with the client-credentials flow (#667): the application permission <c>GroupMember.Read.All</c> (or
/// <c>Group.Read.All</c>) with admin consent. A 429 or 503 waits for <c>Retry-After</c> (at most <see cref="MaxWait"/>) and tries
/// again; a page link that points anywhere but the Graph host is refused, so that a hostile or broken answer cannot make the
/// service call another address with its token.
/// </summary>
public sealed class HttpGraphClient(HttpClient http, IOptions<GraphOptions> options, TimeProvider time) : IGraphClient
{
    public static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(60);
    public const int MaxAttempts = 4;
    public const int MaxPages = 200;

    private string? _token;
    private DateTimeOffset _tokenExpires;

    public async Task<string?> GetGroupNameAsync(string groupId, CancellationToken cancellationToken)
    {
        var url = new Uri(BaseUri(), $"groups/{Uri.EscapeDataString(GroupId(groupId))}?$select=displayName");
        using var response = await SendAsync(url, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        using var json = await ReadAsync(response, cancellationToken);
        return json.RootElement.TryGetProperty("displayName", out var name) && name.ValueKind == JsonValueKind.String
            ? name.GetString()
            : null;
    }

    public async Task<IReadOnlyList<GraphMember>> GetMembersAsync(string groupId, CancellationToken cancellationToken)
    {
        var members = new List<GraphMember>();
        var next = new Uri(BaseUri(),
            $"groups/{Uri.EscapeDataString(GroupId(groupId))}/transitiveMembers/microsoft.graph.user"
            + "?$select=id,displayName,mail,userPrincipalName&$top=100");
        for (var page = 0; next is not null; page++)
        {
            if (page >= MaxPages)
            {
                throw new GraphException($"The group has more than {MaxPages} pages of members; the sync stops.");
            }

            using var response = await SendAsync(next, cancellationToken);
            using var json = await ReadAsync(response, cancellationToken);
            if (json.RootElement.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in value.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object
                        && Text(item, "id") is { Length: > 0 } id)
                    {
                        members.Add(new GraphMember(id,
                            Text(item, "displayName"),
                            Text(item, "mail"),
                            Text(item, "userPrincipalName")));
                    }
                }
            }

            next = json.RootElement.TryGetProperty("@odata.nextLink", out var link) &&
                   link.ValueKind == JsonValueKind.String
                ? CheckedLink(link.GetString())
                : null;
        }

        return members;
    }

    /// <summary>The next page's address, or an exception when it is not on the Graph host (same scheme, host and port).</summary>
    private Uri CheckedLink(string? link)
    {
        var root = BaseUri();
        if (!Uri.TryCreate(link, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, root.Scheme, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Host, root.Host, StringComparison.OrdinalIgnoreCase)
            || uri.Port != root.Port
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new GraphException(
                "The directory sent a link to a page that is not on the Graph host; it is not followed.");
        }

        return uri;
    }

    private async Task<HttpResponseMessage> SendAsync(Uri url, CancellationToken cancellationToken)
    {
        for (var attempt = 1;; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", await TokenAsync(cancellationToken));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            HttpResponseMessage response;
            try
            {
                response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException &&
                                      !cancellationToken.IsCancellationRequested)
            {
                throw new GraphException($"The directory could not be reached ({e.GetType().Name}).", e);
            }

            if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.NotFound)
            {
                return response;
            }

            var retryable = response.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable;
            var wait = Wait(response);
            var status = (int)response.StatusCode;
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                _token = null; // it may have been revoked: the next call asks again
            }

            response.Dispose();
            if (!retryable || attempt >= MaxAttempts)
            {
                throw new GraphException($"The directory answered {status}.");
            }

            await Task.Delay(wait, time, cancellationToken);
        }
    }

    private static TimeSpan Wait(HttpResponseMessage response)
    {
        var retryAfter = response.Headers.RetryAfter;
        TimeSpan delta = retryAfter?.Delta
                         ?? (retryAfter?.Date is { } date ? date - DateTimeOffset.UtcNow : TimeSpan.FromSeconds(2));
        if (delta < TimeSpan.Zero)
        {
            delta = TimeSpan.Zero;
        }

        return delta > MaxWait ? MaxWait : delta;
    }

    private async Task<string> TokenAsync(CancellationToken cancellationToken)
    {
        // One run asks one group after the other, so there is no second caller to wait for.
        {
            if (_token is not null && time.GetUtcNow() < _tokenExpires)
            {
                return _token;
            }

            var o = options.Value;
            var url = new Uri(
                $"{o.Authority.TrimEnd('/')}/{Uri.EscapeDataString(o.TenantId.Trim())}/oauth2/v2.0/token");
            var root = BaseUri();
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials",
                    ["client_id"] = o.ClientId.Trim(),
                    ["client_secret"] = o.ClientSecret,
                    ["scope"] = $"{root.GetLeftPart(UriPartial.Authority)}/.default",
                }),
            };
            HttpResponseMessage response;
            try
            {
                response = await http.SendAsync(request, cancellationToken);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException &&
                                      !cancellationToken.IsCancellationRequested)
            {
                throw new GraphException($"The sign-in service could not be reached ({e.GetType().Name}).", e);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                {
                    // The body of a failed token request can name the client; only the status goes into the message.
                    throw new GraphException(
                        $"The sign-in service refused the client ({(int)response.StatusCode}); check the tenant, the client id and the secret.");
                }

                using var json = await ReadAsync(response, cancellationToken);
                var token = Text(json.RootElement, "access_token")
                            ?? throw new GraphException("The sign-in service sent no access token.");
                var seconds = json.RootElement.TryGetProperty("expires_in", out var expires) &&
                              expires.TryGetInt32(out var s)
                    ? s
                    : 300;
                _token = token;
                _tokenExpires = time.GetUtcNow().AddSeconds(Math.Max(30, seconds - 120));
                return token;
            }
        }
    }

    private Uri BaseUri()
    {
        var text = options.Value.BaseUrl.Trim();
        return new Uri(text.EndsWith('/') ? text : text + "/");
    }

    private static string GroupId(string groupId) =>
        Guid.TryParse(groupId, out var id)
            ? id.ToString()
            : throw new GraphException("A group id of the directory is a GUID.");

    private static async Task<JsonDocument> ReadAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            return await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        }
        catch (JsonException e)
        {
            throw new GraphException("The directory sent an answer that is not JSON.", e);
        }
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
