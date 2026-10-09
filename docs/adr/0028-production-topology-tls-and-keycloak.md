# ADR 0028: The production topology: TLS, host names and Keycloak behind the edge

- Status: Proposed
- Date: 2026-10-09
- Issues: #672 (Feature #671, Epic #670); implemented in #673
- Builds on: [ADR 0014](0014-keycloak-identity-provider.md) (Keycloak, the realm as a file), [ADR 0018](0018-kubernetes-packaging.md) (the chart deploys the four services only), [ADR 0023](0023-own-valkey-one-compose-file.md) (one stack definition), ADR 0027 (enterprise sign-in, Proposed in #747) (brokering needs a public Keycloak)

## Context

The stack in this repository is a demo: plain HTTP on port 80, Traefik's dashboard open (`api.insecure: true`), Keycloak in `start-dev` on port 8081 with
the admin `admin`/`admin`, a realm that carries four users with their own names as passwords and the direct password grant, and development secrets as
literals in `docker-compose.yml`. [Self-hosting](../self-hosting.md) lists what a real deployment has to change and says nothing about **how**. #673
writes that overlay and the guide; this ADR decides the shape first, because every answer reaches the realm file, the frontend's settings, the Helm
values and the enterprise identity epic (#636, whose brokered login needs Keycloak to be reachable at a public URL).

What exists today (checked in the code on 2026-10-09):

- **Tokens carry the issuer the browser used** (`OIDC_ISSUER_URL`, `http://localhost:8081/realms/elysion`); the services fetch keys from a different,
  internal address (`OIDC_JWKS_URI`, `http://keycloak:8080/...`). The frontend gets its authority from a settings file served at runtime
  (`auth-settings.ts`), so one build runs everywhere.
- Traefik has one entry point, `web` (`:80`), no TLS and no ACME; the Helm chart renders an `IngressRoute` on `edge.entryPoints` (default `web`) with an
  optional `edge.tlsSecretName`, and **does not deploy Keycloak, Postgres, Valkey or the object store**.
- `realm-elysion.json`: `sslRequired: none`; `elysion-frontend` with redirect URIs and web origins on `localhost` and `directAccessGrantsEnabled: true`
  (the demo's smoke test and the browser tests use the password grant); `elysion-bff` with the secret `elysion-bff-dev-secret`; four users.
- Secrets with development values in `docker-compose.yml`: `WS_TOKEN_SECRET`, `INTERNAL_API_SECRET`, the database passwords, Keycloak's admin and the
  RustFS keys; `scripts/setup-dev-env.mjs` generates random ones only for the apps that run on the host.

## Options

### Keycloak's place

**A. Behind Traefik on a path of the application host** (`https://elysion.example/auth`, `--http-relative-path=/auth`). The issuer becomes
`https://elysion.example/auth/realms/elysion`.

**B. Its own host name behind Traefik** (`https://id.example`, `KC_HOSTNAME=https://id.example`). The issuer is `https://id.example/realms/elysion`.

**C. Not part of the stack:** an existing Keycloak or another OpenID Connect provider; the realm is a file to import there.

| Criterion                      | A: path of the app host                                                                                                                                      | B: own host                                                                                                                                                                                                                                                                 | C: external                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Cookies and CORS               | Same origin: no CORS on the token endpoint. Keycloak's cookies sit on the app's host (path-scoped to `/auth/realms/...`).                                    | Cross-origin: the SPA calls the token endpoint of another origin, so the client's web origins (CORS) must be right (they are in the realm already). Use **sibling subdomains of one registrable domain** (`elysion.example`, `id.example`) so the cookies stay first-party. | Cross-origin, and the provider's own rules.                       |
| Certificates                   | One host, one certificate.                                                                                                                                   | Two hosts: two certificates, or one wildcard (DNS-01).                                                                                                                                                                                                                      | The provider's own.                                               |
| The demo on `localhost`        | Different from the demo (port 8081 stays there), so the realm differs by configuration.                                                                      | The demo keeps `localhost:8081`, which is already "another origin": the same shape as production.                                                                                                                                                                           | Not applicable.                                                   |
| Keycloak's own settings        | `--http-relative-path` is a **build-time** option of Keycloak; `/auth` is a prefix of the app's route table and its assets and redirects must all honour it. | `KC_HOSTNAME` and `KC_PROXY_HEADERS=xforwarded`; nothing about paths.                                                                                                                                                                                                       | None here.                                                        |
| Keycloak's own headers and CSP | Keycloak's login pages share a host with the app, whose CSP (#680) has to allow them.                                                                        | Their own host, their own headers; the app's CSP names the provider once (`connect-src`, `form-action`).                                                                                                                                                                    | The provider's.                                                   |
| The admin console              | On the app's host, so it must be blocked by path.                                                                                                            | On its own host, blocked by path or not routed at all.                                                                                                                                                                                                                      | Not ours.                                                         |
| Helm chart                     | Unchanged (it takes an issuer URL).                                                                                                                          | Unchanged.                                                                                                                                                                                                                                                                  | Unchanged, and it is the only shape the chart can express anyway. |
| Enterprise identity (#636)     | Entra redirects to `https://elysion.example/auth/realms/elysion/broker/entra/endpoint`.                                                                      | Entra redirects to `https://id.example/realms/elysion/broker/entra/endpoint`.                                                                                                                                                                                               | Wherever the provider is.                                         |
| Cost of getting it wrong       | A path prefix touches every redirect, theme asset and the frontend's authority.                                                                              | A host name is a value.                                                                                                                                                                                                                                                     | None, but Elysion cannot promise a realm it does not run.         |

**Recommendation: B for production, C documented**, and the demo keeps port 8081. Nothing in the services changes between them (issuer, audience, JWKS
address), which is the point of ADR 0014. A is workable but ties Keycloak's build options and routes to the app's; its one advantage, same-origin, is
bought back by sibling subdomains.

**Keycloak is exposed in part.** Traefik routes only `/realms/` and `/resources/` of the identity host to Keycloak (login, tokens, keys, the account
pages and their assets); **`/admin` and the master realm are not routed**. Administration happens on the internal network (`docker compose exec`, an SSH
tunnel, `kubectl port-forward`). `KC_HOSTNAME_ADMIN` keeps its links internal. The temporary bootstrap admin (`KC_BOOTSTRAP_ADMIN_*`, first start only)
is replaced by a named administrator and deleted, as Keycloak's own guidance says.

### TLS termination

**1. Traefik with ACME** (Let's Encrypt): HTTP-01 (port 80 reachable from the internet, one certificate per host, no DNS credentials) or DNS-01 (works
behind a firewall and allows a wildcard, needs an API token for the DNS zone).

**2. A provided certificate**: a file mounted into Traefik, or a Kubernetes Secret.

| Criterion                      | ACME HTTP-01                                             | ACME DNS-01                                   | Provided certificate                |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Operator effort                | None after the first start.                              | A DNS API token, a provider-specific setting. | Renewal is theirs (or their PKI's). |
| Needs from the network         | Port 80 open to the internet, the names resolving to it. | Nothing inbound.                              | Nothing.                            |
| Fits a company with its own CA | No.                                                      | No.                                           | Yes.                                |
| State                          | `acme.json` in a volume (mode 600).                      | The same.                                     | Files or a Secret.                  |

**Recommendation:** in **compose**, Traefik with ACME HTTP-01 as the default of the production overlay, and a **provided certificate** as the documented
alternative (a file provider entry); DNS-01 is a paragraph in the guide, not a configuration we ship. In **Kubernetes** the chart **never does ACME**: the
cluster's cert-manager makes a Secret of type `kubernetes.io/tls` and the chart references it (`edge.tlsSecretName`, which exists), exactly because
a chart that talks to Let's Encrypt owns a certificate lifecycle it cannot see.

**The edge in production** also means: a `websecure` entry point on `:443` and a permanent redirect from `web`; Traefik's dashboard and `api.insecure`
off (the dashboard is reachable only on the internal network, behind a router with a password, or not at all); the `metrics` entry point still not
published; and the Docker socket, which the dev stack mounts read-only into Traefik, replaced by a socket proxy or by the file provider
(a service that can read the Docker API can read every container's environment, secrets included).

**HSTS: yes**, `Strict-Transport-Security: max-age=31536000` on both hosts, **without** `includeSubDomains` and **without** `preload` (those commit a
whole domain, which is not ours to commit). The guide tells an operator to start with `max-age=604800` (one week) for the first deployment and raise it
once it is known to work, because a wrong HSTS header cannot be taken back from a browser that has seen it.

### Host names and the realm

The realm's redirect URIs and web origins must be exactly the application host (and `localhost` only in the dev realm); the realm file is imported
**without** the development users and **without** `directAccessGrantsEnabled`, with `sslRequired: external`.

**Decision on how:** keep **one** source of truth and **derive** the production realm from it. `scripts/build-realm.mjs` reads
`infra/keycloak/realm-elysion.json` and writes the production realm: removes the `users`, sets `directAccessGrantsEnabled: false` and
`sslRequired: external`, and replaces the redirect URIs, web origins and the BFF client secret with Keycloak's `${VAR}` placeholders
(`ELYSION_APP_URL`, `ELYSION_BFF_CLIENT_SECRET`), which Keycloak's import substitutes from the environment (the same mechanism #639 uses for the
identity provider). A test asserts the output has no `users`, no direct grants, no `localhost` and no literal secret. Two files that are edited by
hand would diverge the first time somebody adds a client.

### Secrets

- **Compose:** a `docker-compose.prod.yml` overlay (an overlay, so ADR 0023's "one stack definition" holds: it overrides settings, it does not define
  services) that sets every secret as `${NAME:?NAME is required}`, so an unset secret **stops** the start instead of falling back to a development value
  in the base file. `scripts/setup-prod-env.mjs` writes a git-ignored `.env.production` with random values for what is generated (`WS_TOKEN_SECRET`,
  `INTERNAL_API_SECRET`, database and Keycloak passwords, the BFF client secret, the object store keys) and asks for what is not (`ELYSION_APP_URL`,
  `ELYSION_ID_URL`, the ACME email). It never overwrites a file that exists.
- **Kubernetes:** the existing Secret (`secrets.existingSecret`), as today, with the new keys of #702 (`S3_*`); nothing in a committed values file.
- **No development default stays reachable in the production profile:** a test in CI renders the production compose configuration
  (`docker compose -f docker-compose.yml -f docker-compose.prod.yml config`) with a complete `.env` and fails if any of the known development values
  (`admin`/`admin`, `dev-only-`, `elysion123`, `elysion-bff-dev-secret`) appears in it.

## Decision (proposed)

1. **Keycloak on its own host name behind Traefik (B)**, sibling subdomains of one registrable domain; **only `/realms/` and `/resources/` are routed**,
   the admin console is internal; an external provider (C) is documented and needs no other change. The demo keeps `localhost:8081` and `start-dev`.
2. **TLS:** Traefik with ACME HTTP-01 by default in compose, a provided certificate as the documented alternative; in Kubernetes the chart never does ACME
   (cert-manager makes the Secret). HSTS `max-age=31536000` on both hosts, no `includeSubDomains`, no `preload`, one week for a first deployment.
3. **The edge:** `websecure` on 443 with a redirect, dashboard and `api.insecure` off, no Docker socket in a production Traefik.
4. **The realm:** derived from the development realm by `scripts/build-realm.mjs` (no users, no direct grant, `sslRequired: external`, placeholders for the
   URLs and the BFF secret), tested.
5. **Secrets:** a `docker-compose.prod.yml` overlay with required variables and `scripts/setup-prod-env.mjs`; the Kubernetes Secret as today; a CI check
   that no development value survives in the rendered production configuration.
6. **New configuration names** (documented in `docs/specs/gateway.md` and `docs/self-hosting.md`): `ELYSION_APP_URL`, `ELYSION_ID_URL`, `ELYSION_ACME_EMAIL`,
   `ELYSION_BFF_CLIENT_SECRET`; the services' own (`OIDC_ISSUER_URL`, `OIDC_JWKS_URI`, `CORS_ALLOWED_ORIGINS`) are set from them by the overlay.

## Rejected options

- **A (a path of the app host):** a build-time option of Keycloak and a prefix that every redirect, asset and the frontend's authority must honour; the
  one benefit (same origin) is available with sibling subdomains.
- **DNS-01 as the default:** it needs a credential for the DNS zone in the stack; an operator who needs a wildcard or has no inbound port 80 can set it up
  from the guide.
- **Two realm files kept by hand:** they diverge.
- **HSTS with `includeSubDomains` and `preload` from the start:** not reversible, and Elysion does not own the rest of an operator's domain.
- **Exposing the admin console with a firewall rule in front of it:** one wrong rule is a public administrator login; not routing it is the safer default.

## Consequences

- #673 builds the overlay, the Traefik production configuration, `build-realm.mjs`, `setup-prod-env.mjs` and the rewritten self-hosting guide; #677 (the
  security review) and #680 (headers and CSP) use the host names decided here (the CSP allows `ELYSION_ID_URL` for `connect-src` and `form-action`).
- The frontend's authority and every service's `OIDC_ISSUER_URL` are set from `ELYSION_ID_URL` plus `/realms/elysion`; the demo's value does not change.
- Entra's redirect URI is `${ELYSION_ID_URL}/realms/elysion/broker/entra/endpoint` (ADR 0027).
- A deployment now has two certificates (or one wildcard); `acme.json` is state that has to be in the backup next to the database.
- `docs/specs/gateway.md` gets a "TLS" section and `docs/self-hosting.md` links this ADR from "What a real deployment needs".

## Open questions for the owner

- Which environments come first: **compose on one host**, **Kubernetes**, or both? The proposal builds compose first (#673) and uses cert-manager
  for the chart, but if only Kubernetes matters, the compose overlay can shrink to documentation.
- Is there a domain to design against? The guide uses `elysion.example` and `id.example` as placeholders.

## Decision

_Proposed. To be accepted by the product owner, who then removes `needs-decision` from #672._
