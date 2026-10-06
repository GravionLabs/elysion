# ADR 0017: How the realtime service authenticates to the business backend's internal API

- Status: Proposed
- Date: 2026-10-06
- Issues: #475, #476 (Feature #20); implemented in #477 and #478
- Builds on: [ADR 0011](0011-board-document-persistence.md), [ADR 0014](0014-keycloak-identity-provider.md)

## Context

The realtime service stores and loads the Yjs state of boards through the business backend's
`/internal/boards/{boardId}/document` API (ADR 0011). Since #116 every endpoint of the backend requires a Keycloak
token (the fallback policy), and this one is **anonymous on purpose, for now**: the realtime service has no token and
`/internal` is not routed at the edge. That is the one hole in the fallback policy: anything that can reach the backend
on the compose network (or, in production, in the cluster) can read, overwrite or delete any board's content, without
any identity, and the document API has no notion of who may touch which board.

The questions this ADR answers: what does the realtime service present, how does the backend check it, and what
happens when the thing it depends on is down. Constraints:

- The realtime service must keep **persisting boards even when Keycloak is unavailable**: a save that fails is retried
  but the board is only safe once it is stored, so persistence should not depend on more services than it has to.
- The backend already validates Keycloak tokens (issuer `http://localhost:8081/realms/elysion` in the stack, audience
  `elysion-bff`); the BFF and the realtime service already share a secret (`WS_TOKEN_SECRET`) and a package
  (`@elysion/shared-types`).
- Whatever is chosen must **not** let an ordinary user's access token call `/internal`: those tokens are valid for the
  backend's other endpoints, so "any valid token" is the wrong check.

## Prototype and measurements

A service-account token was fetched the way the realtime container would: from inside the compose network, with
client credentials (the `elysion-bff` client of the realm, which has a service account), at
`http://keycloak:8080/realms/elysion/protocol/openid-connect/token`. The token is valid for 300 seconds, and its claims are:

| Claim | Value                                 |
| ----- | ------------------------------------- |
| `iss` | `http://keycloak:8080/realms/elysion` |
| `azp` | `elysion-bff`                         |
| `aud` | `account`                             |

Two consequences: the **issuer is the address the token was requested at**, not `http://localhost:8081/...`, so the
backend's issuer check (`OIDC_ISSUER_URL`) would reject it unless Keycloak is given a fixed frontend URL
(`KC_HOSTNAME`) or the backend accepts a second issuer; and the **audience** is Keycloak's default (`account`), not
`elysion-bff`, so a client-specific audience mapper is needed as well.

## Options

**A. A Keycloak service account (client credentials).** A new confidential client `elysion-realtime` with a service
account; the realtime service fetches an access token from Keycloak (and renews it every few minutes), the backend
validates it like any other and requires `azp = elysion-realtime` (a policy, not "any token"). The identity is
Keycloak's, so it can be revoked and audited there. Needs: the client and an audience mapper in the realm, a fixed
Keycloak hostname (see above), a token cache with renewal in the realtime service, and a second authorization policy
in the backend.

**B. A shared secret header.** The realtime service sends `X-Internal-Key: <secret>` with every call; the backend
compares it in constant time. Smallest change. The secret travels with every request (it shows up in anything that logs
headers), never expires, and a request cannot be told apart in time (a recorded one can be replayed).

**C. The network alone (status quo).** Compose network isolation, in production a Kubernetes NetworkPolicy. No code.
Any workload in the network can use the API, and there is no identity to audit; defense in depth is lost for no gain
in simplicity once the other endpoints are authenticated.

**D. A short-lived signed service token (a self-issued JWT, shared secret).** The same pattern as the WS token: the
realtime service signs a JWT (HS256, `INTERNAL_API_SECRET`, `iss: elysion-realtime`, `aud: elysion-backend-internal`,
a lifetime of a minute) and sends it as `Authorization: Bearer`; the backend validates signature, issuer, audience and
expiry with a **second authentication scheme** that only `/internal` accepts, and nothing else accepts. The secret
never travels, tokens expire (a recorded request stops working), and no other service is involved.

| Criterion                               | A: Keycloak service account                           | B: shared secret header       | C: network only | D: signed short-lived token                    |
| --------------------------------------- | ----------------------------------------------------- | ----------------------------- | --------------- | ---------------------------------------------- |
| Persistence works when Keycloak is down | Only while a cached token lasts (5 min), not on start | Yes                           | Yes             | Yes                                            |
| An ordinary user token cannot call it   | Needs `azp` policy                                    | Yes (not a bearer token)      | n/a             | Yes (another scheme, issuer and audience)      |
| The credential travels on the wire      | A token (expires in 5 min)                            | The secret itself, every call | Nothing         | A token (expires in a minute)                  |
| Replay of a recorded request            | For up to 5 minutes                                   | For ever                      | n/a             | For up to a minute                             |
| Identity, revocation and audit          | Keycloak                                              | None; rotate the secret       | None            | None; rotate the secret                        |
| New moving parts                        | Client + mapper + fixed hostname + renewal + policy   | One header check              | None            | A second scheme + a signer (small)             |
| Reuses what exists                      | The IdP                                               | -                             | -               | `jose`, `shared-types`, the WS-token pattern   |
| Secret management                       | One more client secret                                | One more shared secret        | -               | One more shared secret (`INTERNAL_API_SECRET`) |

## Decision (proposed)

1. **Option D: the realtime service presents a short-lived signed service token.** It is made and checked like the WS
   token, so there is nothing new to learn, and it needs neither Keycloak nor a new network path to keep persistence
   working.
2. **The contract goes into `@elysion/shared-types`** next to the WS token: issuer `elysion-realtime`, audience
   `elysion-backend-internal`, HS256, a lifetime of 60 seconds, `INTERNAL_API_SECRET` (at least 32 characters, required
   by both services, never the same value as `WS_TOKEN_SECRET`). The realtime service signs a new token per call (or
   reuses one for most of its lifetime).
3. **The backend accepts it on `/internal/*` only**: a second JWT bearer scheme with its own validation parameters
   and a named policy (`InternalService`); the Keycloak scheme does not accept it and this scheme does not accept
   Keycloak tokens. `AllowAnonymous` is removed from the document API; `/health` stays open.
4. **The service-to-service secret is configuration, not code:** `INTERNAL_API_SECRET` in the compose file (a
   development value), in `.env.example` of the realtime service and in the backend's configuration; the backend does not
   start without it (fail closed, like `WS_TOKEN_SECRET` in the BFF and the realtime service).
5. **When to revisit:** adopt option A when something besides these two services needs to call internal APIs (then an
   identity per service, with revocation and audit, is worth the Keycloak dependency), or when the system moves to a
   service mesh that issues workload identities (mTLS), which replaces this scheme altogether.

## Consequences

- The document API stops being an open door inside the network: a caller needs the shared secret to mint a token, and a
  recorded request is useless after a minute.
- A leaked `INTERNAL_API_SECRET` allows anyone to mint tokens until it is rotated; there is no per-service revocation.
  This is the trade against option A and the reason for point 5.
- Realtime and backend must be deployed with the same `INTERNAL_API_SECRET`; a mismatch makes every save and load fail
  with 401, which the realtime service already treats as a failed persistence (it retries and closes connections for a
  board it cannot load).
- The backend gets a second authentication scheme; the policy and the scheme names are the one place to look when
  somebody asks "what can call `/internal`".
- Clock difference between the two services up to a few seconds is tolerated (the same tolerance as the WS token);
  a larger one makes tokens look expired or not yet valid.

## Owner decision

To be filled in when accepted. Open for the owner: **D (recommended)**, A, B, or C. Until this ADR is Accepted, #477 and #478
do not start and the `needs-decision` label stays on #475.
