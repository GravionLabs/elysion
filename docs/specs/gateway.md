# Gateway spec

## Owner

Infra

## Responsibilities

TLS termination, OIDC/JWT auth validation (provider: Keycloak, ADR 0014), CORS, rate limiting, routing, observability. See ADR 0001.

## Routes

| Path        | Target                        | Notes                                                                                  |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `/api/*`    | BFF                           | public; JWT required once auth lands (Epic #91)                                        |
| `/yjs`      | Realtime backend (WebSocket)  | the canvas connects to `ws(s)://<host>/yjs?board=<id>`; token checked at the handshake |
| `/internal` | none (business backend)       | internal only: not routed at the edge; the BFF calls `http://business-backend:8080`    |
| `/`         | Frontend (nginx, Angular app) | lowest priority: every more specific route wins                                        |

The canvas builds its WebSocket URL from the page's host (`/yjs`), and `YjsGateway` listens on `path: '/yjs'`, so
no path rewriting is needed. Traefik passes WebSocket upgrades through natively. Earlier drafts named the
realtime route `/realtime/*`; the service never used it.

In the dev stack (`pnpm dev:stack`) these routes are Docker labels in `infra/docker/docker-compose.yml`; Traefik
routes over the `elysion_elysion` network because some services also join `local-infra`.

## Open questions

- Authentication: the identity provider is Keycloak and services only validate tokens ([ADR 0014](../adr/0014-keycloak-identity-provider.md)); how the edge enforces it is #121.
- Final choice between Traefik-only vs. dedicated API gateway (Kong/APIM) for production.
