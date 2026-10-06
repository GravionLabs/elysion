# ADR 0014: Keycloak as the identity provider, services only validate tokens

- Status: accepted
- Date: 2026-10-05
- Issues: #111, #370, #371, #372, #373, #95
- Builds on: [ADR 0001](0001-gateway-and-bff.md), [ADR 0006](0006-shared-local-infrastructure.md)

## Context

Users, sharing and per-board roles (Epic #91) need sign-in. The specs of the gateway, the BFF and the
business backend each listed authentication as open. Before any service validates a token, the project
needs one identity provider with a reproducible development setup, so that every later PBI (#112 token flow,
#114 to #117 backend, #119 to #122 edge and realtime, #306 frontend login) builds against the same issuer,
clients and test user.

## Decision

1. **An external OpenID Connect provider, not a hand-rolled one.** Password storage, login pages, token
   signing and key rotation, account recovery and brute-force protection are security-critical and not what
   Elysion is about. A provider also gives single sign-on and social or enterprise login later without
   changes in the services.
2. **Keycloak.** Open source (Apache-2.0), standard OIDC with PKCE and JWKS, realms and roles that can be
   committed as a file, runs as one container. Considered and not chosen: Authentik (smaller ecosystem for
   realm-as-code), a hosted provider such as Auth0 or Entra ID (cost and a dependency on the network for every
   local run), and ASP.NET Core Identity (a hand-rolled provider, point 1).
3. **Services are pure token validators.** The business backend, the BFF and the realtime service never see
   a password and never call Keycloak per request: they verify the signature of the JWT with the provider's
   JWKS, the issuer and the audience. Sessions, login and refresh are the browser's business with Keycloak.
4. **Elysion's own compose file defines it, not local-infra** (ADR 0006): Keycloak is specific to this
   project. It is started by `pnpm dev:infra` with Traefik, Postgres and RustFS; it is not behind the `apps`
   profile, because the apps on the host need it as much as the stack does.
5. **The realm is a committed file** (`infra/keycloak/realm-elysion.json`), imported with `--import-realm`, so a
   clean checkout gives an identical provider without clicking in the console. Keycloak keeps its state in
   its own database `keycloak` in the existing Postgres, so it survives `docker compose down` without `-v`.
   A one-shot service (`keycloak-db`) creates the database if it is missing: a script in
   `docker-entrypoint-initdb.d` would only run on an empty data volume, not on the volume a developer already
   has. An import only happens for a realm that does not exist yet, so a restart does not reset it, and
   changes of the file reach a running provider only after its database is dropped.

## The development realm

| What               | Value                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console            | http://localhost:8081 (port 8081: Traefik's dashboard owns 8080), admin `admin` / `admin`                                                                                                                                              |
| Realm              | `elysion`, issuer `http://localhost:8081/realms/elysion`                                                                                                                                                                               |
| `elysion-frontend` | public client, authorization code with PKCE (S256), redirect URIs `http://localhost:4200/*` (`ng serve`) and `http://localhost/*` (the stack behind Traefik); the direct password grant is on, for scripted checks in development only |
| `elysion-bff`      | confidential client with a service account; secret `elysion-bff-dev-secret`                                                                                                                                                            |
| Realm role         | `board-user`                                                                                                                                                                                                                           |
| Dev user           | `dev` / `dev`, email `dev@elysion.local`, role `board-user`                                                                                                                                                                            |
| Second dev user    | `guest` / `guest`, email `guest@elysion.local`, role `board-user`: somebody to share a board with (#324)                                                                                                                               |

All of these are development values in a committed file. Production gets its own realm configuration with
other secrets, HTTPS (`sslRequired` is `none` here) and no password grant; that work is not part of this ADR.

## Checks

```sh
pnpm dev:infra
curl -fsS http://localhost:8081/realms/elysion/.well-known/openid-configuration   # "issuer":"http://localhost:8081/realms/elysion"
curl -s http://localhost:8081/realms/elysion/protocol/openid-connect/token \
  -d grant_type=password -d client_id=elysion-frontend -d username=dev -d password=dev   # access_token for the dev user
curl -s http://localhost:8081/realms/elysion/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=elysion-bff -d client_secret=elysion-bff-dev-secret
```

Checked from an empty `keycloak` database (dropped and recreated by `keycloak-db`): the realm is imported, the
discovery document answers, and the password grant returns a token whose `iss` is the issuer above,
`azp` is `elysion-frontend`, `preferred_username` is `dev` and `realm_access.roles` holds `board-user`. After
`docker compose restart keycloak` the same token request still works.

## Consequences

- One more container in the development infrastructure (about 500 MB of memory); the first start takes
  half a minute while Keycloak builds and imports.
- The access token carries `aud: elysion-bff`, added by an audience mapper on `elysion-frontend` (#116); the services
  require it (docs/specs/identity.md).
- Keycloak is not routed through Traefik: the browser talks to it directly on port 8081, which matches the
  issuer URL in the tokens. Putting it behind the edge (and changing the issuer) is a later decision.
- The realm file is the one place that defines clients and roles; a change needs an import into a fresh
  database (`DROP DATABASE keycloak`, then `pnpm dev:infra`).
