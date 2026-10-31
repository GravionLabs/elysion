using Elysion.BusinessBackend.Api.AccessTokens;
using Elysion.BusinessBackend.Api.Entities;

using Shouldly;

namespace Elysion.BusinessBackend.Tests.AccessTokens;

/// <summary>The shape of a token, its hash and its scopes (ADR 0033).</summary>
public class AccessTokenSecretsTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 11, 12, 0, 0, TimeSpan.Zero);

    [Test]
    public void A_token_is_the_prefix_and_43_letters_or_digits()
    {
        var token = AccessTokenSecrets.Generate();

        token.ShouldMatch("^elp_[0-9A-Za-z]{43}$");
        AccessTokenSecrets.LooksValid(token).ShouldBeTrue();
        AccessTokenSecrets.DisplayPrefix(token).ShouldBe(token[..12]);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("elp_tooShort")]
    [TestCase("xyz_0123456789012345678901234567890123456789012")]
    [TestCase("elp_012345678901234567890123456789012345678901-")]
    [TestCase("elp_0123456789012345678901234567890123456789012x")]
    public void Anything_else_does_not_look_like_a_token(string? token) =>
        AccessTokenSecrets.LooksValid(token).ShouldBeFalse();

    [Test]
    public void The_hash_is_the_lower_case_sha256()
    {
        // printf 'elp_test' | shasum -a 256
        AccessTokenSecrets.Hash("elp_test")
            .ShouldBe("fbb23c843e56a85e27382cafc411cfe55e81de29f2de30201ab73057d889cba5");
    }

    [TestCase("Bearer elp_abc", "elp_abc")]
    [TestCase("bearer   elp_abc", "elp_abc")]
    [TestCase("Bearer eyJhbGciOi.x.y", null)]
    [TestCase("Basic elp_abc", null)]
    [TestCase(null, null)]
    public void Only_a_bearer_header_with_the_prefix_carries_a_token(string? header, string? expected) =>
        AccessTokenSecrets.FromAuthorizationHeader(header).ShouldBe(expected);

    [Test]
    public void Scopes_keep_the_known_ones_once_in_their_order()
    {
        AccessTokenScopes.Parse("profile webhooks:write boards:read boards:read email")
            .ShouldBe(["boards:read", "webhooks:write"]);
        AccessTokenScopes.Parse(null).ShouldBeEmpty();
        AccessTokenScopes.Format(["members:write", "boards:read", "nope"]).ShouldBe("boards:read members:write");
    }

    [Test]
    public void A_token_refuses_an_expiry_beyond_a_year_or_before_it_was_made()
    {
        var secret = AccessTokenSecrets.Generate();

        AccessToken Make(DateTimeOffset expires) =>
            AccessToken.Create(Guid.CreateVersion7(),
                Guid.CreateVersion7(),
                "n",
                secret[..12],
                AccessTokenSecrets.Hash(secret),
                ["boards:read"],
                Now,
                expires);

        Make(Now.AddDays(365)).ExpiresAt.ShouldBe(Now.AddDays(365));
        Should.Throw<ArgumentException>(() => Make(Now.AddDays(365).AddSeconds(1)));
        Should.Throw<ArgumentException>(() => Make(Now));
    }

    [Test]
    public void A_token_refuses_no_scope_and_an_unknown_one()
    {
        var secret = AccessTokenSecrets.Generate();

        AccessToken Make(string[] scopes) =>
            AccessToken.Create(Guid.CreateVersion7(),
                Guid.CreateVersion7(),
                "n",
                secret[..12],
                AccessTokenSecrets.Hash(secret),
                scopes,
                Now,
                Now.AddDays(1));

        Should.Throw<ArgumentException>(() => Make([]));
        Should.Throw<ArgumentException>(() => Make(["admin"]));
    }
}
