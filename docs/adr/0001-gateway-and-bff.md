# 0001 — Traefik as edge gateway, NestJS BFF

## Status
Accepted

## Context
Elysion needs a single entry point for TLS termination, auth validation, rate limiting, and routing to the BFF, realtime backend, and (internally) the business backend. It also needs a UI-optimized aggregation layer so the frontend isn't calling multiple granular business APIs directly.

## Decision
- Use **Traefik** as the edge gateway for PoC/production (Docker-native label-based routing; can be swapped for Kong/APIM later without touching services).
- Use a dedicated **NestJS BFF** for UI-facing aggregation, caching (Redis), and token exchange for the WebSocket handshake, rather than exposing the .NET business backend directly.

## Consequences
- Extra deployable (BFF) and extra hop, but keeps the business backend free of UI concerns and internet exposure.
- Traefik config lives in `infra/traefik/`; routing labels live alongside each service's docker-compose block in `infra/docker/docker-compose.yml`.
