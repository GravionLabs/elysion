# Business backend spec (.NET 10)

## Owner
Backend

## Responsibilities
Domain logic, persistence (PostgreSQL), templates, export service (PNG/PDF). Internal-only, exposed via gateway/BFF. See ADR 0003.

## Services (draft)
- Auth service (JWT/OIDC issuance/validation)
- Board service (CRUD)
- Template service
- Export service

## Open questions
- REST vs gRPC for internal BFF <-> business-backend calls (packages/proto reserved for this).
