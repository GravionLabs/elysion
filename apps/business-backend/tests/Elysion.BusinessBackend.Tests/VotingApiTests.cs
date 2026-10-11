using System.Net;
using System.Net.Http.Json;

using Elysion.BusinessBackend.Api.Contracts;
using Elysion.BusinessBackend.Api.Voting;

using Shouldly;

namespace Elysion.BusinessBackend.Tests;

/// <summary>Dot voting on the server: who may vote, what each person sees, and what the realtime service is told (#732, ADR 0029).</summary>
public class VotingApiTests
{
    private ApiFactory _factory = null!;
    private HttpClient _owner = null!;
    private HttpClient _viewer = null!;
    private HttpClient _editor = null!;
    private Guid _boardId;

    [SetUp]
    public async Task SetUp()
    {
        _factory = new ApiFactory();
        _owner = _factory.CreateAuthenticatedClient("kc-sub-1");
        _viewer = _factory.CreateAuthenticatedClient("kc-sub-2");
        _editor = _factory.CreateAuthenticatedClient("kc-sub-3");
        // A person exists once their token was seen; then the owner can add them by email.
        await _viewer.GetAsync("/boards");
        await _editor.GetAsync("/boards");
        var created = await _owner.PostAsJsonAsync("/boards", new BoardNameRequest("Voting board"));
        _boardId = (await created.Content.ReadFromJsonAsync<BoardDto>())!.Id;
        await _owner.PostAsJsonAsync($"/boards/{_boardId}/members",
            new { email = "kc-sub-2@example.com", role = "Viewer" });
        await _owner.PostAsJsonAsync($"/boards/{_boardId}/members",
            new { email = "kc-sub-3@example.com", role = "Editor" });
    }

    [TearDown]
    public void TearDown()
    {
        _owner.Dispose();
        _viewer.Dispose();
        _editor.Dispose();
        _factory.Dispose();
    }

    private string Url(string path = "") => $"/boards/{_boardId}/{path}";

    private async Task<VotingDto> StartAsync(int votes = 3, bool named = false, string? name = "Priorities")
    {
        var response = await _owner.PostAsJsonAsync(Url("votings"), new { name, votesPerPerson = votes, named });
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<VotingDto>())!;
    }

    private static async Task<HttpResponseMessage> VoteAsync(HttpClient client, string url, string element) =>
        await client.PostAsJsonAsync(url, new { elementId = element });

    private string VotesUrl(Guid votingId) => Url($"votings/{votingId}/votes");

    [Test]
    public async Task A_board_without_a_voting_answers_204()
    {
        (await _owner.GetAsync(Url("voting"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task Starting_opens_a_voting_with_the_chosen_settings_and_tells_the_realtime_service()
    {
        var voting = await StartAsync(votes: 5, named: true, name: "  Top picks ");

        voting.Name.ShouldBe("Top picks");
        (voting.VotesPerPerson, voting.Status, voting.Named, voting.MyVotes).ShouldBe((5, "open", true, 0));
        voting.StartedBy.Id.ShouldBe("kc-sub-1");
        (await _owner.GetFromJsonAsync<VotingDto>(Url("voting")))!.Id.ShouldBe(voting.Id);
        var sent = _factory.Notifications.Sent.ShouldHaveSingleItem();
        (sent.BoardId, sent.Event, sent.Voting!.Id).ShouldBe((_boardId, VotingEvents.Start, voting.Id));
    }

    [Test]
    public async Task A_blank_name_is_Voting()
    {
        (await StartAsync(name: "  ")).Name.ShouldBe("Voting");
    }

    [TestCase(0)]
    [TestCase(101)]
    public async Task Votes_per_person_outside_1_to_100_are_refused(int votes)
    {
        var response = await _owner.PostAsJsonAsync(Url("votings"), new { votesPerPerson = votes });

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _owner.GetAsync(Url("voting"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task Votes_per_person_are_required_and_a_name_has_a_limit()
    {
        (await _owner.PostAsJsonAsync(Url("votings"), new { name = "x" })).StatusCode.ShouldBe(
            HttpStatusCode.BadRequest);
        (await _owner.PostAsJsonAsync(Url("votings"), new { name = new string('x', 81), votesPerPerson = 1 }))
            .StatusCode
            .ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task A_second_voting_cannot_be_started_while_one_is_open()
    {
        await StartAsync();

        var response = await _owner.PostAsJsonAsync(Url("votings"), new { votesPerPerson = 2 });

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task A_viewer_can_vote_but_cannot_start_close_or_clear()
    {
        var voting = await StartAsync();

        (await _viewer.PostAsJsonAsync(Url("votings"), new { votesPerPerson = 2 })).StatusCode.ShouldBe(HttpStatusCode
            .Forbidden);
        (await VoteAsync(_viewer, VotesUrl(voting.Id), "e1")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _viewer.PostAsync(Url($"votings/{voting.Id}/close"), null)).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
        (await _viewer.DeleteAsync(Url("votings"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task An_editor_may_start_and_close()
    {
        var response = await _editor.PostAsJsonAsync(Url("votings"), new { votesPerPerson = 2 });
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var voting = (await response.Content.ReadFromJsonAsync<VotingDto>())!;

        (await _editor.PostAsync(Url($"votings/{voting.Id}/close"), null)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task A_person_without_a_role_on_the_board_gets_404_everywhere()
    {
        var voting = await StartAsync();
        using var stranger = _factory.CreateAuthenticatedClient("kc-sub-9");

        (await stranger.GetAsync(Url("voting"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await VoteAsync(stranger, VotesUrl(voting.Id), "e1")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_vote_counts_for_the_voter_and_is_limited_to_the_votes_per_person()
    {
        var voting = await StartAsync(votes: 2);

        var first = await (await VoteAsync(_viewer, VotesUrl(voting.Id), "e1")).Content.ReadFromJsonAsync<VotingDto>();
        await VoteAsync(_viewer, VotesUrl(voting.Id), "e1");
        var third = await VoteAsync(_viewer, VotesUrl(voting.Id), "e2");

        first!.MyVotes.ShouldBe(1);
        third.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var mine = (await _viewer.GetFromJsonAsync<VotingDto>(Url("voting")))!;
        (mine.MyVotes, mine.MyElementVotes["e1"]).ShouldBe((2, 2));
        // The owner still has all their votes: the limit is per person.
        (await VoteAsync(_owner, VotesUrl(voting.Id), "e2")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Test]
    public async Task While_open_nobody_sees_the_targets_of_another_and_the_news_does_not_hold_them()
    {
        var voting = await StartAsync();
        await VoteAsync(_viewer, VotesUrl(voting.Id), "secret-element");

        var ownersView = (await _owner.GetFromJsonAsync<VotingDto>(Url("voting")))!;
        var raw = await _owner.GetStringAsync(Url("voting"));

        ownersView.MyVotes.ShouldBe(0);
        ownersView.MyElementVotes.ShouldBeEmpty();
        ownersView.Result.ShouldBeNull();
        ownersView.Placed.ShouldNotBeNull().ShouldBe(new Dictionary<string, int> { ["kc-sub-2"] = 1 });
        raw.ShouldNotContain("secret-element");
        var news = _factory.Notifications.Sent.Last();
        news.Event.ShouldBe(VotingEvents.Vote);
        System.Text.Json.JsonSerializer.Serialize(news.Voting).ShouldNotContain("secret-element");
    }

    [Test]
    public async Task A_vote_is_taken_back_one_at_a_time_and_taking_back_what_is_not_there_is_a_204()
    {
        var voting = await StartAsync();
        await VoteAsync(_owner, VotesUrl(voting.Id), "e1");
        await VoteAsync(_owner, VotesUrl(voting.Id), "e1");

        var back = await _owner.DeleteAsync(Url($"votings/{voting.Id}/votes/e1"));
        var view = (await back.Content.ReadFromJsonAsync<VotingDto>())!;

        back.StatusCode.ShouldBe(HttpStatusCode.OK);
        view.MyElementVotes["e1"].ShouldBe(1);
        (await _owner.DeleteAsync(Url($"votings/{voting.Id}/votes/e2"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        // Another person's vote on that element is not yours to take back.
        (await _viewer.DeleteAsync(Url($"votings/{voting.Id}/votes/e1"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        _factory.Notifications.Sent.Last().Event.ShouldBe(VotingEvents.Retract);
    }

    [Test]
    public async Task An_element_id_must_fit()
    {
        var voting = await StartAsync();

        (await VoteAsync(_owner, VotesUrl(voting.Id), new string('x', 129))).StatusCode.ShouldBe(HttpStatusCode
            .BadRequest);
        (await VoteAsync(_owner, VotesUrl(voting.Id), " ")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Closing_shows_counts_per_element_without_names_unless_the_voting_was_named()
    {
        var voting = await StartAsync(votes: 3, named: false);
        await VoteAsync(_owner, VotesUrl(voting.Id), "a");
        await VoteAsync(_viewer, VotesUrl(voting.Id), "a");
        await VoteAsync(_viewer, VotesUrl(voting.Id), "b");

        var closed = await (await _owner.PostAsync(Url($"votings/{voting.Id}/close"), null)).Content
            .ReadFromJsonAsync<VotingDto>();

        closed!.Status.ShouldBe("closed");
        closed.Placed.ShouldBeNull();
        closed.Result!.Select(r => (r.ElementId, r.Count)).ShouldBe([("a", 2), ("b", 1)]);
        closed.Result!.ShouldAllBe(r => r.Voters == null);
        (await _viewer.GetStringAsync(Url("voting"))).ShouldNotContain("kc-sub-2");
        (await _viewer.GetStringAsync(Url("voting"))).ShouldNotContain("voters");
    }

    [Test]
    public async Task A_named_voting_shows_who_voted_for_what_once_closed()
    {
        var voting = await StartAsync(votes: 3, named: true);
        await VoteAsync(_owner, VotesUrl(voting.Id), "a");
        await VoteAsync(_viewer, VotesUrl(voting.Id), "a");
        (await _viewer.GetFromJsonAsync<VotingDto>(Url("voting")))!.Result.ShouldBeNull();

        await _owner.PostAsync(Url($"votings/{voting.Id}/close"), null);

        var seenByViewer = (await _viewer.GetFromJsonAsync<VotingDto>(Url("voting")))!;
        seenByViewer.Result!.Single().Voters!.Select(v => v.Id).ShouldBe(["kc-sub-1", "kc-sub-2"], ignoreOrder: true);
        seenByViewer.Result!.Single().Voters!.ShouldAllBe(v => v.Name.Length > 0);
    }

    [Test]
    public async Task A_closed_voting_takes_no_more_votes_and_closing_again_is_harmless()
    {
        var voting = await StartAsync();
        await _owner.PostAsync(Url($"votings/{voting.Id}/close"), null);
        var announced = _factory.Notifications.Sent.Count;

        (await VoteAsync(_owner, VotesUrl(voting.Id), "a")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await _owner.DeleteAsync(Url($"votings/{voting.Id}/votes/a"))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await _owner.PostAsync(Url($"votings/{voting.Id}/close"), null)).StatusCode.ShouldBe(HttpStatusCode.OK);

        _factory.Notifications.Sent.Count.ShouldBe(announced);
    }

    [Test]
    public async Task After_closing_a_new_voting_can_start_and_the_current_one_is_the_open_one()
    {
        var first = await StartAsync();
        await _owner.PostAsync(Url($"votings/{first.Id}/close"), null);

        var second = await StartAsync(name: "Second");

        (await _owner.GetFromJsonAsync<VotingDto>(Url("voting")))!.Id.ShouldBe(second.Id);
    }

    [Test]
    public async Task Clearing_removes_the_closed_votings_but_not_the_open_one()
    {
        var first = await StartAsync();
        await VoteAsync(_owner, VotesUrl(first.Id), "a");
        await _owner.PostAsync(Url($"votings/{first.Id}/close"), null);
        var open = await StartAsync(name: "Open");

        (await _owner.DeleteAsync(Url("votings"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await _owner.GetFromJsonAsync<VotingDto>(Url("voting")))!.Id.ShouldBe(open.Id);
        _factory.Notifications.Sent.Last().Event.ShouldBe(VotingEvents.Clear);
        await _owner.PostAsync(Url($"votings/{open.Id}/close"), null);
        await _owner.DeleteAsync(Url("votings"));
        (await _owner.GetAsync(Url("voting"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        _factory.Notifications.Sent.Last().Voting.ShouldBeNull();
    }

    [Test]
    public async Task A_voting_of_another_board_is_not_found_on_this_one()
    {
        var voting = await StartAsync();
        var other = await (await _owner.PostAsJsonAsync("/boards", new BoardNameRequest("Other"))).Content
            .ReadFromJsonAsync<BoardDto>();

        (await VoteAsync(_owner, $"/boards/{other!.Id}/votings/{voting.Id}/votes", "a")).StatusCode
            .ShouldBe(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task A_request_without_a_json_body_is_415()
    {
        await StartAsync();

        (await _owner.PostAsync(Url("votings"), null)).StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
    }
}
