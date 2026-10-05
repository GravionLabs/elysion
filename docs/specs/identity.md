# Identity and the token flow

How a person signs in and how that identity reaches every service, in one place. The decision to use Keycloak
and to keep services as pure token validators is [ADR 0014](../adr/0014-keycloak-identity-provider.md); this
document fixes the flow, the WS token and the configuration names that the identity PBIs build against: #116,
#114 to #117 (Feature #20 and #96), #119 and #120 (Feature #13), #121 (Feature #8), #122 and #303 (Feature
#18), #306 and #312 (Feature #97).

## The flow

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (Angular shell + canvas)
    participant K as Keycloak
    participant T as Traefik
    participant F as BFF
    participant D as Business backend
    participant R as Realtime (/yjs)

    B->>K: authorization code flow with PKCE (client elysion-frontend)
    K-->>B: access token (JWT, short-lived) + refresh token
    B->>T: GET /api/boards, Authorization: Bearer access token
    T->>F: forwardAuth: GET /auth/verify (same headers)
    F-->>T: 200 + X-User-Id, X-User-Email (or 401)
    T->>F: the original request, now with the user headers
    F->>D: the call, Authorization: Bearer access token
    D-->>F: data (D validates the JWT and the board role itself)
    B->>T: POST /api/boards/{id}/ws-token, Bearer access token
    T->>F: forwardAuth, then the request
    F->>D: may this user open the board, as what?
    D-->>F: role (owner, editor or viewer)
    F-->>B: WS token (HS256, about 60 s, boardId + role)
    B->>R: WebSocket /yjs?board={id}&token=WS token
    R->>R: verify signature, expiry and boardId; role decides read-only
    R-->>B: sync (or a close with 4401 / 4403)
```

1. **The browser logs in against Keycloak** with the authorization code flow and PKCE (public client
   `elysion-frontend`). No service ever sees a password. The shell keeps the access token in memory and
   refreshes it with the refresh token (#306).
2. **Every `/api/*` call carries `Authorization: Bearer <access token>`.** Traefik asks the BFF whether the
   token is valid before the request goes on (below); the BFF forwards the same header to the business
   backend, which validates the JWT again and enforces membership and roles (#116, #117). A token is checked
   by every service that acts on it, none trusts a header set by another.
3. **The BFF exchanges the access token for a board-scoped WS token** (`POST /api/boards/{id}/ws-token`, #120).
   The BFF, not the gateway, issues it: ADR 0001 already gives token exchange for the WebSocket handshake to the
   BFF, and the BFF is the service that can ask the business backend for the user's role on that board.
4. **The realtime service validates the WS token at the handshake** (#122) and uses the role to refuse updates
   from viewers (#303). It never talks to Keycloak and never sees the access token.

## Edge: forwardAuth, not a Traefik JWT middleware

**Traefik's open-source edition has no JWT-validating middleware** (that is part of the commercial Traefik
Hub). Do not look for one and do not write one in Traefik's config. The edge validates with the
[`forwardAuth`](https://doc.traefik.io/traefik/middlewares/http/forwardauth/) middleware: for each request on a
protected router Traefik calls the BFF's verify endpoint with the request's headers, passes the request on
when the answer is `2xx` and returns the BFF's answer (`401`) otherwise.

- Verify endpoint: `GET /auth/verify` on the BFF (#119). It validates the access token against Keycloak's JWKS
  (signature, `iss`, `aud`, expiry) and answers `200` with `X-User-Id` (the `sub` claim) and `X-User-Email`, or
  `401`. The middleware lists these in `authResponseHeaders` so they reach the BFF's route handlers.
- Protected: the `/api` router (#121). Public: `/` (the Angular app, which must load to start the login),
  `/health` of each service, and `/yjs`: a WebSocket upgrade carries the WS token in its URL and the realtime
  service checks it itself, so the edge does not need to.
- The BFF's own routes (`/auth/verify` included) are reached by Traefik over the compose network. A request from
  outside to `/auth/verify` would only ever answer about the caller's own token, and is not routed.

## The WS token

A short-lived JWT, signed by the BFF and verified by the realtime service with a shared secret.

| Part         | Value                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Algorithm    | HS256, with `WS_TOKEN_SECRET` shared by BFF and realtime (at least 32 random bytes). No Keycloak key is involved |
| `iss`        | `elysion-bff`                                                                                                    |
| `aud`        | `elysion-realtime`                                                                                               |
| `sub`        | the user's id: the access token's `sub`                                                                          |
| `boardId`    | the board the token opens, exactly the id used in `?board=`                                                      |
| `role`       | `owner`, `editor` or `viewer`, as the business backend answered; a viewer is read-only (#303)                    |
| `iat`, `exp` | issued-at and expiry; the lifetime is `WS_TOKEN_TTL_SECONDS`, 60 by default                                      |

- **Transport:** a query parameter, `wss://<host>/yjs?board=<id>&token=<jwt>`. `@nestjs/platform-ws` gives a
  gateway no access to headers during the handshake, and the board id already travels in the URL. Because a URL
  can end up in logs, the token is short-lived and only good for one board; nothing else is in it.
- **Checked once, at the handshake.** An open connection outlives its token. The client fetches a new token
  every time it connects, so each reconnect (the client reconnects on its own) asks the BFF again; a revoked
  membership therefore ends at the next reconnect at the latest, not instantly.
- **Refusal:** the gateway closes the socket right after the upgrade with code `4401` (missing, malformed,
  expired or wrongly signed token) or `4403` (the token is valid but for another board). The canvas reports
  that as the element's `error` event; it does not retry with the same token.
- **Without a token** (development without the identity stack) the gateway keeps accepting connections only
  while `WS_TOKEN_SECRET` is unset; setting it turns the check on for every connection.

How the shell hands the token to the canvas element (an attribute, a method or a changed URL) is decided in
#312; this document ends at the URL the canvas connects to.

## Configuration names

One table for every downstream PBI. Services read these from the environment; a missing required one stops
the service at startup with a clear message (the BFF's config module is #118).

| Variable               | Used by                          | Meaning                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`      | BFF, business backend            | The issuer the access tokens carry: `http://localhost:8081/realms/elysion` in development. Tokens with another `iss` are refused                                                                                                    |
| `OIDC_AUDIENCE`        | BFF, business backend            | The audience a token must contain: `elysion-bff`. The realm gets an audience mapper for it on `elysion-frontend` in the first PBI that validates (#116)                                                                             |
| `KEYCLOAK_REALM`       | compose, scripts, realm tooling  | The realm name, `elysion`. Services only need `OIDC_ISSUER_URL`                                                                                                                                                                     |
| `WS_TOKEN_SECRET`      | BFF (signs), realtime (verifies) | The HS256 secret of the WS token, at least 32 random bytes, identical in both. A development default lives in the compose file, never in production                                                                                 |
| `WS_TOKEN_TTL_SECONDS` | BFF                              | Lifetime of a WS token, `60` by default                                                                                                                                                                                             |
| `OIDC_JWKS_URI`        | BFF, business backend (optional) | Where to fetch the signing keys; default `<OIDC_ISSUER_URL>/protocol/openid-connect/certs`. Needed inside the compose network, where Keycloak is `http://keycloak:8080` but the issuer in the tokens is `http://localhost:8081/...` |

The last row is the one trap of the setup: the _issuer_ is a name inside the token and has to match what the
browser used, the _JWKS address_ is where a service can actually reach Keycloak. In the containers they differ,
so the services must not derive the key address from the issuer there.

## Who does what

| Service          | Validates                                    | Decides                                                          |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Keycloak         | the login                                    | who the user is; issues access and refresh tokens                |
| Traefik          | nothing itself; asks the BFF (`forwardAuth`) | whether `/api/*` requests get through                            |
| BFF              | the access token (`/auth/verify`)            | issues the WS token for a board the user may open                |
| Business backend | the access token (JWT bearer)                | users, board membership, roles and the policies on each endpoint |
| Realtime         | the WS token, at the handshake               | read-only for a viewer; closes with 4401 or 4403 otherwise       |

The business backend's `/internal/*` endpoints (used by the realtime service to store documents, ADR 0011)
stay unrouted at the edge and reachable only on the compose network, as now. Authenticating that service-to-service
call is not part of this flow; it is a follow-up once the user-facing path works.
