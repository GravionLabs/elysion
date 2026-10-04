# Gateway spec

## Owner

Infra

## Responsibilities

TLS termination, OIDC/JWT auth validation, CORS, rate limiting, routing, observability. See ADR 0001.

## Routes (draft)

| Path          | Target                       | Notes                        |
| ------------- | ---------------------------- | ---------------------------- |
| `/api/*`      | BFF                          | public, JWT required         |
| `/realtime/*` | Realtime backend (WebSocket) | JWT validated at handshake   |
| `/internal/*` | Business backend             | internal only, mTLS optional |

## Open questions

- Final choice between Traefik-only vs. dedicated API gateway (Kong/APIM) for production.
