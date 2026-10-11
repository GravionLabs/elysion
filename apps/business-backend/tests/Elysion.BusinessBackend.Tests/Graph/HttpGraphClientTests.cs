using System.Net;
using System.Net.Http.Headers;

using Elysion.BusinessBackend.Api.Graph;

using Microsoft.Extensions.Options;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.Graph;

/// <summary>The Graph client against a directory in a delegate (#667): the token, paging, throttling and the links it refuses.</summary>
public class HttpGraphClientTests
{
    private const string Group = "11111111-1111-4111-8111-111111111111";
    private const string Base = "https://graph.test/v1.0/";

    private static GraphOptions Options(string baseUrl = Base) => new()
    {
        TenantId = "tenant-1", ClientId = "client-1", ClientSecret = "s3cret", Authority = "https://login.test",
        BaseUrl = baseUrl
    };

    private static HttpGraphClient Client(FakeGraphHandler handler,
        TimeProvider? time = null,
        GraphOptions? options = null) =>
        new(new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(options ?? Options()),
            time ?? TimeProvider.System);

    private static bool IsToken(HttpRequestMessage r) => r.RequestUri!.Host == "login.test";

    private static Dictionary<string, object> Page(object[] people, string? next = null) =>
        next is null
            ? new Dictionary<string, object> { ["value"] = people }
            : new Dictionary<string, object> { ["value"] = people, ["@odata.nextLink"] = next };

    [Test]
    public async Task It_asks_for_a_token_with_the_client_credentials_and_sends_it_to_graph()
    {
        var handler = new FakeGraphHandler(r => IsToken(r)
            ? FakeGraphHandler.Token("abc")
            : FakeGraphHandler.Json(new { displayName = "Sales" }));

        var name = await Client(handler).GetGroupNameAsync(Group, CancellationToken.None);

        name.ShouldBe("Sales");
        var token = handler.Requests[0];
        token.RequestUri!.ToString().ShouldBe("https://login.test/tenant-1/oauth2/v2.0/token");
        handler.Bodies[0].ShouldContain("grant_type=client_credentials");
        handler.Bodies[0].ShouldContain("client_id=client-1");
        handler.Bodies[0].ShouldContain("scope=https%3A%2F%2Fgraph.test%2F.default");
        handler.Requests[1].Headers.Authorization.ShouldBe(new AuthenticationHeaderValue("Bearer", "abc"));
        handler.Requests[1].RequestUri!.AbsolutePath.ShouldBe($"/v1.0/groups/{Group}");
    }

    [Test]
    public async Task A_group_the_directory_does_not_have_has_no_name()
    {
        var handler = new FakeGraphHandler(r => IsToken(r)
            ? FakeGraphHandler.Token()
            : new HttpResponseMessage(HttpStatusCode.NotFound));

        (await Client(handler).GetGroupNameAsync(Group, CancellationToken.None)).ShouldBeNull();
    }

    [Test]
    public async Task It_follows_the_pages_and_reads_the_address_from_mail_or_the_sign_in_name()
    {
        var handler = new FakeGraphHandler(r =>
        {
            if (IsToken(r))
            {
                return FakeGraphHandler.Token();
            }

            return r.RequestUri!.Query.Contains("skiptoken", StringComparison.Ordinal)
                ? FakeGraphHandler.Json(Page([
                    new { id = "o3", displayName = "Cy", userPrincipalName = "cy@example.com" }
                ]))
                : FakeGraphHandler.Json(Page(
                    [
                        new
                        {
                            id = "o1", displayName = "Ann", mail = "Ann@Example.com",
                            userPrincipalName = "ann@x.onmicrosoft.com"
                        },
                        new { id = "o2", displayName = "Bob", userPrincipalName = "not-an-address" },
                    ],
                    $"{Base}groups/{Group}/transitiveMembers/microsoft.graph.user?$skiptoken=2"));
        });

        var members = await Client(handler).GetMembersAsync(Group, CancellationToken.None);

        members.Select(m => m.Email).ShouldBe(["Ann@Example.com", null, "cy@example.com"]);
        handler.Requests.Count(r => !IsToken(r)).ShouldBe(2);
        handler.Requests.First(r => !IsToken(r)).RequestUri!.Query.ShouldContain(
            "$select=id,displayName,mail,userPrincipalName");
    }

    [Test]
    public async Task A_429_waits_for_Retry_After_and_asks_again()
    {
        var time = new ImmediateTimeProvider();
        var calls = 0;
        var handler = new FakeGraphHandler(r =>
        {
            if (IsToken(r))
            {
                return FakeGraphHandler.Token();
            }

            if (++calls == 1)
            {
                var throttled = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
                throttled.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(7));
                return throttled;
            }

            return FakeGraphHandler.Json(Page([new { id = "o1", mail = "ann@example.com" }]));
        });

        var members = await Client(handler, time).GetMembersAsync(Group, CancellationToken.None);

        members.Count.ShouldBe(1);
        calls.ShouldBe(2);
        time.Waits.ShouldContain(TimeSpan.FromSeconds(7));
    }

    [Test]
    public async Task A_wait_is_capped_and_endless_throttling_ends_with_an_exception()
    {
        var time = new ImmediateTimeProvider();
        var handler = new FakeGraphHandler(r =>
        {
            if (IsToken(r))
            {
                return FakeGraphHandler.Token();
            }

            var throttled = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            throttled.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromHours(2));
            return throttled;
        });

        await Should.ThrowAsync<GraphException>(() =>
            Client(handler, time).GetMembersAsync(Group, CancellationToken.None));

        time.Waits.ShouldAllBe(w => w <= HttpGraphClient.MaxWait);
        handler.Requests.Count(r => !IsToken(r)).ShouldBe(HttpGraphClient.MaxAttempts);
    }

    [TestCase("https://evil.example/v1.0/steal?$skiptoken=1")]
    [TestCase("http://graph.test/v1.0/downgrade")]
    [TestCase("https://graph.test:8443/v1.0/other-port")]
    [TestCase("https://user:pw@graph.test/v1.0/credentials")]
    [TestCase("/v1.0/relative")]
    public async Task A_page_link_that_is_not_on_the_Graph_host_is_not_followed(string link)
    {
        var handler = new FakeGraphHandler(r => IsToken(r)
            ? FakeGraphHandler.Token()
            : FakeGraphHandler.Json(Page([new { id = "o1", mail = "ann@example.com" }], link)));

        await Should.ThrowAsync<GraphException>(() => Client(handler).GetMembersAsync(Group, CancellationToken.None));

        handler.Requests.Select(r => r.RequestUri!.Host)
            .Distinct()
            .ShouldBe(["login.test", "graph.test"], ignoreOrder: true);
        handler.Requests.ShouldAllBe(r => r.RequestUri!.Host != "evil.example");
    }

    [Test]
    public async Task A_refused_client_is_an_exception_that_names_no_secret()
    {
        var handler = new FakeGraphHandler(r => IsToken(r)
            ? FakeGraphHandler.Json(new { error = "invalid_client", error_description = "the secret s3cret is wrong" },
                HttpStatusCode.Unauthorized)
            : new HttpResponseMessage(HttpStatusCode.OK));

        var error = await Should.ThrowAsync<GraphException>(() =>
            Client(handler).GetMembersAsync(Group, CancellationToken.None));

        error.Message.ShouldNotContain("s3cret");
        error.Message.ShouldContain("401");
    }

    [Test]
    public async Task The_token_is_asked_for_once_and_reused()
    {
        var handler = new FakeGraphHandler(r => IsToken(r)
            ? FakeGraphHandler.Token()
            : FakeGraphHandler.Json(new { displayName = "G" }));
        var client = Client(handler);

        await client.GetGroupNameAsync(Group, CancellationToken.None);
        await client.GetGroupNameAsync(Group, CancellationToken.None);

        handler.Requests.Count(IsToken).ShouldBe(1);
    }

    [Test]
    public async Task A_group_id_that_is_not_a_GUID_never_becomes_part_of_an_address()
    {
        var handler = new FakeGraphHandler(r => FakeGraphHandler.Token());

        await Should.ThrowAsync<GraphException>(() =>
            Client(handler).GetMembersAsync("../../users", CancellationToken.None));

        handler.Requests.ShouldBeEmpty();
    }

    [Test]
    public async Task A_server_error_is_an_exception_with_the_status()
    {
        var handler = new FakeGraphHandler(r => IsToken(r)
            ? FakeGraphHandler.Token()
            : new HttpResponseMessage(HttpStatusCode.InternalServerError));

        var error = await Should.ThrowAsync<GraphException>(() =>
            Client(handler).GetMembersAsync(Group, CancellationToken.None));

        error.Message.ShouldContain("500");
    }
}
