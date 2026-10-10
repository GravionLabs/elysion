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
    T->>F: forwardAuth: GET /api/auth/verify (same headers)
    F-->>T: 200 + X-Auth-User-Id, X-Auth-User-Email (or 401)
    T->>F: the original request, now with the user headers
    F->>D: the call, Authorization: Bearer access token
    D-->>F: data (D validates the JWT and the board role itself)
    B->>T: POST /api/realtime/token {boardId}, Bearer access token
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
3. **The BFF exchanges the access token for a board-scoped WS token** (`POST /api/realtime/token` with `{ "boardId": "..." }`, #120; it answers `{ token, expiresAt }`).
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

- Verify endpoint: `GET /api/auth/verify` on the BFF (#119; under `/api` like the BFF's other routes). It validates
  the access token against Keycloak's JWKS (signature, `iss`, `aud`, expiry) and answers `200` with `X-Auth-User-Id`
  (the `sub` claim) and `X-Auth-User-Email`, or `401`. The middleware lists these in `authResponseHeaders` so they reach the BFF's route handlers.
- Protected: the `/api` router (#121). Public: `/` (the Angular app, which must load to start the login),
  `/health` of each service, and `/yjs`: a WebSocket upgrade carries the WS token in its URL and the realtime
  service checks it itself, so the edge does not need to.
- The verify endpoint sits behind the same `/api` route as the rest of the BFF, so it is reachable from outside too;
  that is harmless: it only ever answers about the caller's own token.

## The WS token

The contract below lives in code as well: `packages/shared-types` (`@elysion/shared-types`, compiled to plain JS and `.d.ts`) exports the claims type, the issuer, audience and algorithm constants, the roles and the close codes, and both the BFF and the realtime service import it, so the two cannot drift.

**Issuing** (`POST /api/realtime/token`, BFF): the caller must be signed in, and the BFF asks the business backend for the caller's role on the board (`GET /boards/{id}/membership/me`, with the caller's own access token). **No role is `403`**; a board that does not exist and a board the caller may not see look the same, and an id that is not a stored board's UUID is `403` without asking anybody. A token is never minted merely because the caller is authenticated. The backend's `Owner`, `Editor` and `Viewer` become `owner`, `editor` and `viewer` in the token.

A short-lived JWT, signed by the BFF and verified by the realtime service with a shared secret.

| Part         | Value                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Algorithm    | HS256, with `WS_TOKEN_SECRET` shared by BFF and realtime (at least 32 random bytes). No Keycloak key is involved |
| `iss`        | `elysion-bff`                                                                                                    |
| `aud`        | `elysion-realtime`                                                                                               |
| `sub`        | the user's id: the access token's `sub`                                                                          |
| `boardId`    | the board the token opens, exactly the id used in `?board=`                                                      |
| `role`       | `owner`, `editor` or `viewer`, as the business backend answered; a viewer is read-only (#303)                    |
| `jti`        | a random id; the token opens one socket (below)                                                                  |
| `iat`, `exp` | issued-at and expiry; the lifetime is `WS_TOKEN_TTL_SECONDS`, 60 by default                                      |

- **Transport:** a query parameter, `wss://<host>/yjs?board=<id>&token=<jwt>`. `@nestjs/platform-ws` gives a
  gateway no access to headers during the handshake, and the board id already travels in the URL. Because a URL
  can end up in logs, the token is short-lived and only good for one board; nothing else is in it.
- **Checked at the handshake, and again while the socket is open (#772).** An open connection outlives its token, so
  the realtime service asks the business backend every `MEMBERSHIP_RECHECK_MS` (15 s by default, `0` is off) what role
  each person has on each board of the instance (`GET /internal/boards/{id}/access?sub=`, the service token of
  ADR 0017, one call per person and board however many sockets they have). **No role any more** (removed, the board
  deleted): the person's sockets are closed with `4403`, and the client's reconnect asks the BFF for a new token and
  is told no. **Another role:** it applies to the open sockets at once (a viewer's writes are dropped from then on).
  **The backend cannot be reached:** nothing changes and the next round tries again. So a revoked membership ends
  within the interval, not at the next reconnect.
- **Single-use.** A token has a `jti`; the realtime service remembers it in Valkey (`elysion:wsjti:<jti>`, `SET NX`
  for the rest of the token's life) and refuses a second socket with the same token (`4401`). A token without a
  `jti` (an older BFF) is not checked; with Valkey unreachable the token is let in and the failure is logged.
- **Refusal:** the gateway closes the socket right after the upgrade with code `4401` (missing, malformed,
  expired or wrongly signed token) or `4403` (the token is valid but for another board). The canvas reports
  that as the element's `error` event; it does not retry with the same token.
- **Fail closed:** the realtime service does not start without `WS_TOKEN_SECRET` (at least 32 characters), so a
  missing setting can never leave the gateway open. Every connection needs a token.

The shell hands the token to the canvas through the element's `tokenProvider` property (#312, ADR 0010): the canvas asks it before every connection, the shell answers by calling `POST /api/realtime/token`.

## Configuration names

One table for every downstream PBI. Services read these from the environment; a missing required one stops
the service at startup with a clear message (the BFF's config module is #118).

| Variable                                                                            | Used by                                       | Meaning                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`                                                                   | BFF, business backend                         | The issuer the access tokens carry: `http://localhost:8081/realms/elysion` in development. Tokens with another `iss` are refused                                                                                                    |
| `OIDC_AUDIENCE`                                                                     | BFF, business backend                         | The audience a token must contain: `elysion-bff`. The realm gets an audience mapper for it on `elysion-frontend` in the first PBI that validates (#116)                                                                             |
| `KEYCLOAK_REALM`                                                                    | compose, scripts, realm tooling               | The realm name, `elysion`. Services only need `OIDC_ISSUER_URL`                                                                                                                                                                     |
| `WS_TOKEN_SECRET`                                                                   | BFF (signs), realtime (verifies)              | The HS256 secret of the WS token, at least 32 random bytes, identical in both. A development default lives in the compose file, never in production                                                                                 |
| `INTERNAL_API_SECRET`                                                               | realtime (signs), business backend (verifies) | HS256 secret of the service token for the internal document API (ADR 0017), at least 32 characters, identical in both, never the value of `WS_TOKEN_SECRET`. Required: neither service starts without it                            |
| `WS_TOKEN_TTL_SECONDS`                                                              | BFF                                           | Lifetime of a WS token, `60` by default                                                                                                                                                                                             |
| `OIDC_JWKS_URI`                                                                     | BFF, business backend (optional)              | Where to fetch the signing keys; default `<OIDC_ISSUER_URL>/protocol/openid-connect/certs`. Needed inside the compose network, where Keycloak is `http://keycloak:8080` but the issuer in the tokens is `http://localhost:8081/...` |
| `OIDC_GROUPS_CLAIM`                                                                 | business backend (proposed)                   | The claim with the person's groups, an array of strings: `groups` ([ADR 0027](../adr/0027-enterprise-sign-in-groups-and-administration.md))                                                                                         |
| `OIDC_ROLES_CLAIM`                                                                  | business backend (proposed)                   | Where the realm roles are in the token: `realm_access.roles`                                                                                                                                                                        |
| `OIDC_ADMIN_ROLE`                                                                   | business backend (proposed)                   | The role that makes an administrator: `elysion-admin`                                                                                                                                                                               |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_ADMIN_GROUP_ID` | realm import, compose (proposed)              | The Microsoft Entra ID tenant and app registration of the identity provider `entra`, and the group whose members become administrators; the secret is never committed                                                               |

The access token's audience is added by an audience mapper on `elysion-frontend` in the realm file (`aud: elysion-bff`); the business backend checks it (#116).

The last row is the one trap of the setup: the _issuer_ is a name inside the token and has to match what the
browser used, the _JWKS address_ is where a service can actually reach Keycloak. In the containers they differ,
so the services must not derive the key address from the issuer there.

## Enterprise sign-in

Proposed in [ADR 0027](../adr/0027-enterprise-sign-in-groups-and-administration.md), implemented by Epic #636; none of it exists yet. Entra ID is an
OpenID Connect identity provider of the realm `elysion` (**identity brokering**): the services keep validating Keycloak's tokens, and a second realm
`entra-stub` plays Entra in development and in the browser tests. Groups come from the token's `groups` claim (object ids) into local and linked groups;
the administrator is the realm role `elysion-admin` and gets no role on any board. **Claims are as of the person's last brokered login**: Keycloak does
not ask Entra again when it refreshes a token, so a change in Entra reaches Elysion within the realm's SSO session maximum (8 hours proposed). The new
configuration names are in the table above.

## Who does what

| Service          | Validates                                    | Decides                                                          |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Keycloak         | the login                                    | who the user is; issues access and refresh tokens                |
| Traefik          | nothing itself; asks the BFF (`forwardAuth`) | whether `/api/*` requests get through                            |
| BFF              | the access token (`/api/auth/verify`)        | issues the WS token for a board the user may open                |
| Business backend | the access token (JWT bearer)                | users, board membership, roles and the policies on each endpoint |
| Realtime         | the WS token, at the handshake               | read-only for a viewer; closes with 4401 or 4403 otherwise       |

The business backend's `/internal/*` endpoints (used by the realtime service to store documents, ADR 0011) are not
routed at the edge, and they take only one credential: a **service token** the realtime service signs itself
([ADR 0017](../adr/0017-internal-api-authentication.md)). It is a JWT, HS256 with `INTERNAL_API_SECRET` (shared by the
realtime service and the business backend, at least 32 characters, never the value of `WS_TOKEN_SECRET`), issuer
`elysion-realtime`, audience `elysion-backend-internal`, valid for 60 seconds, made for every call; the backend checks it
with a second authentication scheme that only `/internal/*` uses. A user's Keycloak token does not open `/internal`, and
the service token opens nothing else. Keycloak is not involved, so persisting boards does not depend on it.
