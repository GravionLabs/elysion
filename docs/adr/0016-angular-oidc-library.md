# ADR 0016: Which OIDC library the Angular app uses to log in

- Status: Accepted
- Date: 2026-10-05
- Issues: #307 (Task of #306, Feature #97)
- Builds on: [ADR 0014](0014-keycloak-identity-provider.md), [ADR 0009](0009-angular-shell-state.md)

## Context

The Angular shell needs a login (#306): the authorization code flow with PKCE against the public client
`elysion-frontend` of the Keycloak realm, silent token renewal, a route guard that sends anonymous users to the
login, an HTTP interceptor that adds the bearer token to `/api` calls only, a restart of the login on `401`,
and the user's name for the top bar and the canvas presence (`user-name`). The shell is Angular 22 with
standalone APIs and signals (ADR 0009). ADR 0014 keeps the identity provider replaceable: the services only
validate tokens, so the frontend should not be needed to change when the provider does more than Keycloak.

Hand-written code is not an option for this: a login flow (state and nonce, PKCE, token endpoint, refresh,
logout, clock skew) is exactly what a maintained library exists for.

## Candidates

Facts taken from the npm registry and GitHub on 2026-10-05.

| Criterion                 | A: `angular-auth-oidc-client`                                          | B: `angular-oauth2-oidc`                        | C: `keycloak-angular` (+ `keycloak-js`)                                |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Latest version            | 22.0.1 (2026-09-27)                                                    | 22.0.2 (2026-07-02)                             | 22.0.0 (2026-06-15); `keycloak-js` 26.2.4 (2026-04)                    |
| Angular range             | `>=20` (works on 22)                                                   | `>=22`                                          | `^22`                                                                  |
| Provider                  | any standards-based OpenID provider (discovery)                        | any standards-based OpenID provider             | **Keycloak only** (`keycloak-js`)                                      |
| Authorization code + PKCE | yes                                                                    | yes                                             | yes                                                                    |
| Silent renewal            | refresh tokens, or a silent-renew iframe                               | refresh tokens, or a silent-refresh iframe      | `keycloak-js` token update                                             |
| Standalone setup          | `provideAuth(...)`                                                     | `provideOAuthClient(...)`                       | `provideKeycloak(...)`                                                 |
| Guard and interceptor     | `autoLoginPartialRoutesGuard`, `authInterceptor()` with `secureRoutes` | none included: write a guard and an interceptor | `createAuthGuard`, `includeBearerTokenInterceptor` with URL conditions |
| Runtime dependencies      | `rfc4648`, `tslib`                                                     | `tslib`                                         | `keycloak-js`, `tslib`                                                 |
| Package size (unpacked)   | 976 KB                                                                 | 420 KB                                          | 257 KB + 110 KB                                                        |
| Repository activity       | pushed 2026-10-03; releases in Aug and Sep                             | pushed 2026-07-05; releases in Jun and Jul      | pushed 2026-09-28; one release for Angular 22 (June)                   |
| Open issues               | 272                                                                    | 309                                             | 51                                                                     |
| Licence                   | MIT                                                                    | MIT                                             | MIT (`keycloak-js`: Apache-2.0)                                        |

All three work with Angular 22, standalone APIs and PKCE.

**D. `oidc-client-ts` (framework-neutral) with our own Angular glue.** The most widely used OIDC client, no
Angular lifecycle: we would write the provider, guard, interceptor and refresh scheduling ourselves, which is
what A and C already do for Angular.

## Decision

**A: `angular-auth-oidc-client`.**

1. It speaks plain OIDC with discovery, so the login does not change when the provider does (ADR 0014's point that
   the identity provider is replaceable); C would tie the shell to Keycloak and its JavaScript adapter.
2. It is the only candidate that ships both pieces we need as functional APIs: `autoLoginPartialRoutesGuard` and
   `authInterceptor()` restricted to configured `secureRoutes` (only `/api`, as the PBI requires). B needs both written
   by hand.
3. It is the most actively maintained of the three (a release three weeks ago, two in the last two months) and
   declares a wide Angular range (`>=20`), so an Angular upgrade does not wait for a library release.
4. Its size is the largest, but it is loaded with the app shell only and the difference to B is about 0.5 MB
   unpacked, a small part of what is shipped after tree-shaking.

## Consequences

- One new runtime dependency in `apps/frontend` and its `provideAuth(...)` configuration: authority
  `http://localhost:8081/realms/elysion` in development, client `elysion-frontend`, scope `openid profile email`,
  `useRefreshToken: true`, redirect URIs as already in the realm file; `secureRoutes: ['/api']`.
- **Where the tokens are kept** is a security decision of #306, not a default to accept: the library stores them in
  `sessionStorage` unless told otherwise, which any script on the page (an XSS) can read. The implementation must
  choose and document it, preferring in-memory storage with silent renewal over a persisted token.
- The openness of the issue tracker (272) is mostly feature requests; the points we use (code flow with PKCE, refresh,
  guard, interceptor) are the library's core and are covered by its tests, and the PBI adds our own tests for the
  guard and interceptor with a fake auth service.
- If the shell ever needs Keycloak-specific features (admin console links, account management), `keycloak-js` can be
  added next to it; nothing here prevents that.
- Switching later means replacing the provider, the guard and the interceptor in one place (a small auth module);
  nothing else in the shell depends on the library, because the rest of the app reads the user through the shell's own
  session service (signals, ADR 0009).

## Owner decision

Accepted by the product owner on 2026-10-06: **option A, `angular-auth-oidc-client`**, as recommended above. #306's
implementation (#308 to #311) can start; where the tokens are kept is decided there (see Consequences).
