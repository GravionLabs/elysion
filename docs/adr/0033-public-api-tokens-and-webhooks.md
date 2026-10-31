# ADR 0033: The public API, its access tokens and webhooks

- Status: Accepted (2026-10-30, by the product owner: B for the place, C for authentication with service accounts made in Keycloak
  and with the access of a member, read-only elements in v1, the outbox for webhooks)
- Date: 2026-10-30
- Issues: #850 (Feature #844); implemented in #851, #852 and #853
- Builds on: [ADR 0001](0001-gateway-and-bff.md) (Traefik and the BFF), [ADR 0014](0014-keycloak-identity-provider.md) (Keycloak, services only validate), [ADR 0017](0017-internal-api-authentication.md) (internal calls), [ADR 0027](0027-enterprise-sign-in-groups-and-administration.md) (administration), [ADR 0032](0032-board-snapshots.md) (snapshots, #845)

## Context

Everything Elysion does goes through the browser today. A team that wants to create a board for every sprint from a script,
mirror the board list into its wiki, or hear in its chat when a board changed has no way to do it. #844 asks for a versioned,
documented REST API with tokens a person issues, and for webhooks instead of polling.

What is already there:

- The browser sends the person's Keycloak access token as `Authorization: Bearer` to the BFF; the BFF has a global `AuthGuard`
  (`TokenVerifier`, JWKS, `aud=elysion-bff`) and **forwards that token** to the business backend, which authorizes every call
  (`BoardPolicies`: `Read`, `Write`, `Administer`). There is no session cookie, so there is no CSRF to defend.
- Traefik routes `/api/*` to the BFF with `forwardAuth` (`/api/auth/verify`), CORS from `CORS_ALLOWED_ORIGINS` and an
  in-memory rate limit of 50 requests a second per client address. `/internal` has no edge route.
- A deactivated person is refused by the backend on every request (`UserProvisioningMiddleware`, `account-deactivated`).
- The backend has no outbox and no generic retrying HTTP client; it has hosted services (`AuditRetentionService`,
  `GraphSyncService`). The realtime service saves boards through `PUT /internal/boards/{id}/document`.
- No controller in the BFF uses `@nestjs/swagger`; errors are Nest's default `{statusCode, message, error}`; lists are either
  unpaged (`GET /api/boards`) or offset-paged (admin).
- The BFF has no `yjs`; only the realtime service and the canvas decode a board's document.

## Options

**Where the public API lives.** (A) In the BFF under `/api/v1`, next to the browser's routes: one router, but `forwardAuth`, CORS
and the rate limit by address are made for the browser, and every browser route would have to refuse tokens explicitly. (B) In the
BFF under its own prefix `/public/v1` with its own Traefik router: no CORS, a rate limit per token, a body limit, its own guard; one
place of authorization stays the backend. (C) The business backend exposed through Traefik: breaks ADR 0001 (the backend is never
exposed) and moves the edge concerns (rate limits, logs with the request id) into a second service.

**How a caller authenticates.** (A) Personal access tokens issued by Elysion: random, shown once, stored as a hash, a prefix
`elp_` that secret scanning recognizes, a required expiry, scopes, revocable by the person and by an admin. (B) Keycloak service-account
clients per integration, mapped to an Elysion user: no new secret store, but every integration needs a Keycloak admin, and a client
secret is not tied to a person's board access. (C) Both.

**Webhook delivery.** (A) Send in the request that made the change: a slow receiver slows Elysion, a crash loses the event.
(B) An outbox table written in the same transaction as the change, and a hosted service that delivers with retries.

## Decision

**B, C and B: a `/public/v1` prefix in the BFF; personal access tokens checked by the business backend and Keycloak service
accounts for integrations, both in v1; and an outbox in the business backend.**

### Routing and authentication

- Traefik gets a router `public` for `PathPrefix(/public/v1)` → BFF, with **no CORS middleware** (the API is not for browsers), a
  rate limit keyed by the `Authorization` header (`sourceCriterion.requestHeaderName`; proposal 600 a minute, burst 60), a body
  limit of 1 MiB (`buffering.maxRequestBodyBytes`) and **no `forwardAuth`**: the BFF's guard checks every request itself.
- The BFF's guard accepts a token with the prefix `elp_` **only** on `/public/v1` routes and refuses it (`401`) everywhere else; a
  Keycloak token is accepted on `/public/v1` too, so a person can try the API with the browser's token.
- The BFF forwards the token unchanged to the business backend, which gets a third authentication scheme `AccessToken`, chosen by
  the prefix: it hashes the token (SHA-256; the token has 256 random bits, so no slow hash is needed), looks it up, refuses it when
  expired, revoked or its owner deactivated, and sets the owner as the principal with the token's **scopes** as claims. The lookup
  is cached in memory for 30 s, so a revoke takes effect within that time. Every existing policy keeps working (a token acts as its
  owner and never sees more); each public route also requires its scope.
- **Scopes**: `boards:read`, `boards:write`, `members:write`, `snapshots:write`, `webhooks:write`. A token has at least one and
  expires after at most one year. Creating and revoking are in the audit log (`token.created`, `token.revoked`); `last used` is
  written at most once a minute.

### Service accounts

- An admin creates an integration in Keycloak: a confidential client with the client-credentials grant, an audience mapper that adds
  `elysion-bff`, the realm role `elysion-integration` and the scopes above as optional client scopes. `docs/api.md` describes the
  steps; Elysion does not get admin rights in Keycloak.
- Its token is a Keycloak token like a person's, so the BFF's `TokenVerifier` and the backend's JWT scheme accept it unchanged; it
  is accepted **only** on `/public/v1` (the guard refuses a token with `elysion-integration` on the browser's routes). The backend
  creates its technical user on the first call, as it does for people, marked as an integration (no e-mail, the client id as the
  name); the token's `scope` claim gives its scopes.
- It has the **access of a member**: it sees the boards and rooms it was added to, with the role it was given there, and nothing
  else; the member search shows it as "Integration". The admin pages (ADR 0027) list integrations and deactivate them, which stops
  them on the next call like a deactivated person.

### What v1 covers

Boards (list, read, create, rename, delete, duplicate), rooms (list, read), members of boards and rooms (list, add, change the
role, remove), snapshots (list, create, read as JSON, from ADR 0032) and **the elements of a board, read-only**, as Excalidraw JSON
with files as links. The BFF decodes the stored document with `yjs` (a new dependency there); it is the state of the last save, at
most about 10 s behind an open board. **Writing elements is not in v1**: a write must go through the realtime service to reach the
people on the board and pass its limits and the viewer rule; that is a later version with its own decision.

### Contract

- The public controllers carry `@nestjs/swagger` decorators; an **OpenAPI 3.1** document is generated at build time, committed as
  `docs/api/openapi.v1.json`, compared in CI (a change of the contract shows in the diff) and rendered on the documentation site.
- Versioning in the path. A breaking change is a `/public/v2`; v1 is kept for at least six months after v2 ships and answers with
  `Deprecation` and `Sunset` headers in that time.
- Lists use **cursor pagination** (`?cursor=&limit=`, at most 200, `next` in the body). Errors on the public routes are **problem
  details** (RFC 9457, `application/problem+json`) through an exception filter on those controllers only; the browser's routes
  keep their format. Rename uses `ETag` and `If-Match`.
- Logs carry the token id (never the token) and the request id (ADR 0025).

### Webhooks

- **Who registers**: board owners for their board; admins (ADR 0027) for all boards. Through the shell and the API (`webhooks:write`).
- **Events**: `board.created`, `board.renamed`, `board.deleted`, `board.content.changed` (at most once a minute per board),
  `member.added`, `member.removed`, `member.role_changed`, `snapshot.created`, `comment.created`. `board.content.changed` comes
  from the backend's own document endpoint (the realtime service's save), so the realtime service needs no new call;
  `comment.created` is left out of v1 if comments cannot be told apart in a save without decoding it.
- **Payload**: event id, type, time, board id, actor id and what changed (a new name, a role), **never the board's content**.
- **Delivery**: an outbox table `WebhookDeliveries` written in the same transaction as the change; a hosted service posts with a
  10 s timeout and retries with exponential backoff for 24 hours, then disables the endpoint and tells its owner why. The last 50
  deliveries per endpoint are kept for the UI and can be sent again.
- **Signing**: a secret per endpoint (shown once); `Elysion-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`;
  receivers reject a `t` older than five minutes.
- **SSRF**: only `https` URLs (plain `http` behind a development flag); the hosted service resolves the host itself and refuses
  private, loopback, link-local and unique-local addresses, and connects to the address it checked (no second resolution).

## Consequences

- One new trust boundary (`docs/security.md`): scripts on the internet with a token, at a separate edge route with its own limits.
  A leaked token acts as its person until it expires or is revoked; the prefix lets GitHub's secret scanning find it.
- The backend gets a third authentication scheme, two tables (tokens, webhooks with their deliveries) and a hosted service; the
  BFF gets `yjs` and `@nestjs/swagger`.
- An alert on a growing outbox, with a runbook (#853).
- Service accounts add a kind of user (an integration) to the backend, the member search and the admin pages (#851).
- Out of scope for v1: writing elements, OAuth apps for third parties, integrations made from Elysion's admin pages, access to all
  boards for an integration, webhooks per room.
