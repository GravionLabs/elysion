# ADR 0028: The production topology: TLS, host names and Keycloak behind the edge

- Status: Accepted (2026-10-10, by the product owner; on 2026-10-09 the owner had answered the open questions: **compose is for development and the demo, production is Kubernetes through the Helm chart**)
- Date: 2026-10-09
- Issues: #672 (Feature #671, Epic #670); implemented in #673
- Builds on: [ADR 0014](0014-keycloak-identity-provider.md) (Keycloak, the realm as a file), [ADR 0018](0018-kubernetes-packaging.md) (the chart deploys the four services only), [ADR 0023](0023-own-valkey-one-compose-file.md) (one stack definition), ADR 0027 (enterprise sign-in, Proposed in #747) (brokering needs a public Keycloak)

## Context

The stack in this repository is a demo: plain HTTP on port 80, Traefik's dashboard open (`api.insecure: true`), Keycloak in `start-dev` on port 8081 with
the admin `admin`/`admin`, a realm that carries four users with their own names as passwords and the direct password grant, and development secrets as
literals in `docker-compose.yml`. [Self-hosting](../self-hosting.md) lists what a real deployment has to change and says nothing about **how**. #673
writes that overlay and the guide; this ADR decides the shape first, because every answer reaches the realm file, the frontend's settings, the Helm
values and the enterprise identity epic (#636, whose brokered login needs Keycloak to be reachable at a public URL).

**Owner answer (2026-10-09): compose is for development and the demo; production is Kubernetes through the Helm chart.** So this ADR decides the
production topology **for the chart**. The first draft of it also designed a production compose overlay (ACME in Traefik, required-secret variables, a
production env script); that part is dropped, and the stack in `docker-compose.yml` stays a demo with plain HTTP and development values, which
[self-hosting](../self-hosting.md) already says. What is left of the compose design is noted where it still matters.

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

**In Kubernetes Keycloak is not part of the chart** (ADR 0018), so "behind the edge" means: the operator runs Keycloak in production mode next to the
release (the Keycloak Operator or any chart, with its own database, not Elysion's) and gives it the host name. Elysion's side of that is a **documented
set of Keycloak settings** (`start`, `KC_HOSTNAME=https://id.example`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED` behind the ingress,
`KC_HOSTNAME_ADMIN` internal) and the **realm file** (below), not a chart. The ingress in front of Keycloak routes only `/realms/` and `/resources/`
(login, tokens, keys, the account pages and their assets); **`/admin` and the master realm are not routed**. Administration happens inside the cluster
(`kubectl port-forward`). The temporary bootstrap admin (`KC_BOOTSTRAP_ADMIN_*`, first start only) is replaced by a named administrator and deleted, as
Keycloak's own guidance says. B and C are therefore the same work for Elysion; they differ in who runs the Keycloak.

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

**Recommendation:** in **Kubernetes** the chart **never does ACME**: the cluster's cert-manager (or the operator's own PKI) makes a Secret of type
`kubernetes.io/tls` and the chart references it (`edge.tlsSecretName`, which exists), because a chart that talks to Let's Encrypt owns a certificate
lifecycle it cannot see. How cert-manager gets the certificate (HTTP-01, DNS-01, an internal CA) is the cluster's business and the guide says so in a
paragraph. In **compose** there is no production TLS: the demo stays on port 80.

**The edge in production** is Traefik installed in the cluster (its own chart, ADR 0018), and Elysion's chart renders what is Elysion's:

- **the routes on `websecure`** (`edge.entryPoints: [websecure]`) with `edge.tlsSecretName`, and **a redirect from `web`**: a new
  `edge.redirectToHttps` (default off, so the kind setup keeps working) renders a `redirectScheme` `Middleware` and a second `IngressRoute` on `web`;
- **HSTS** as a `headers` `Middleware` (`stsSeconds`) from `edge.hsts.maxAge`;
- on Traefik's own chart (the operator's values, with an example in the guide): the dashboard off, `api.insecure` off, the `metrics` entry point not
  exposed, and the Kubernetes CRD provider instead of the Docker socket, which the dev stack mounts into Traefik (a service that can read the Docker API
  can read every container's environment, secrets included, so the compose file is development only for that reason too).

**HSTS: yes**, `max-age=31536000` on both hosts, **without** `includeSubDomains` and **without** `preload` (those commit a whole domain, which is not
ours to commit). The guide tells an operator to start with `max-age=604800` (one week) for the first deployment and raise it once it is known to work,
because a wrong HSTS header cannot be taken back from a browser that has seen it.

### Host names and the realm

The realm's redirect URIs and web origins must be exactly the application host (and `localhost` only in the dev realm); the realm file is imported
**without** the development users and **without** `directAccessGrantsEnabled`, with `sslRequired: external`.

**Decision on how:** keep **one** source of truth and **derive** the production realm from it. `scripts/build-realm.mjs` reads
`infra/keycloak/realm-elysion.json` and writes the production realm: removes the `users`, sets `directAccessGrantsEnabled: false` and
`sslRequired: external`, and replaces the redirect URIs, web origins and the BFF client secret with Keycloak's `${VAR}` placeholders
(`ELYSION_APP_URL`, `ELYSION_BFF_CLIENT_SECRET`), which Keycloak's import substitutes from the environment (the same mechanism #639 uses for the
identity provider). A test asserts the output has no `users`, no direct grants, no `localhost` and no literal secret. Two files that are edited by
hand would diverge the first time somebody adds a client. **The operator gets the production realm as a release asset** (CI builds it with the script
and attaches `realm-elysion.production.json` to every GitHub release, next to the images and the chart's version), imports it into their Keycloak with
the environment set (`ELYSION_APP_URL`, `ELYSION_BFF_CLIENT_SECRET`), and adds their own users or identity provider (ADR 0027) there.

### Secrets

- **Kubernetes:** the existing Secret (`secrets.existingSecret`), with the keys the chart README lists (`WS_TOKEN_SECRET`, `INTERNAL_API_SECRET`,
  `POSTGRES_CONNECTION_STRING`, `REDIS_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`); nothing in a committed values file, and the chart refuses a release whose
  Secret is missing (it already fails on a missing `oidc.issuerUrl` and `objectStore.endpoint`). The operator creates it, or their secret operator does.
- **A production example** `infra/helm/elysion/values-production.example.yaml` shows the settings of this ADR (`websecure`, the TLS Secret, the redirect,
  HSTS, replicas above one, the issuer on the identity host) with every host as `*.example`.
- **No development default can reach a production release:** CI renders the chart with the production example (`helm template`) and fails if any
  known development value (`admin`/`admin`, `dev-only-`, `elysion123`, `elysion-bff-dev-secret`, `localhost`) appears in the output.
- **Compose** keeps its development defaults, and `docker-compose.yml` says at its top that it is not a production setup (it already does).

## Decision (proposed)

1. **Production is Kubernetes through the Helm chart; compose is for development and the demo** (the owner's answer). There is no production compose
   overlay.
2. **Keycloak on its own host name behind the ingress (B)**, sibling subdomains of one registrable domain, run by the operator next to the release; **only
   `/realms/` and `/resources/` are routed**, the admin console is internal; an external provider (C) needs nothing else. Elysion documents Keycloak's
   settings and ships the realm. The demo keeps `localhost:8081` and `start-dev`.
3. **TLS:** the chart never does ACME; cert-manager (or the operator's PKI) makes the Secret that `edge.tlsSecretName` names. HSTS `max-age=31536000` on
   both hosts, no `includeSubDomains`, no `preload`, one week for a first deployment.
4. **The edge:** the chart renders the routes on `websecure`, an optional redirect from `web` (`edge.redirectToHttps`) and an HSTS `Middleware`
   (`edge.hsts.maxAge`); Traefik's own chart is configured by the operator without the dashboard, `api.insecure` and the Docker socket.
5. **The realm:** derived from the development realm by `scripts/build-realm.mjs` (no users, no direct grant, `sslRequired: external`, placeholders for the
   URLs and the BFF secret), tested, and attached to every release as `realm-elysion.production.json`.
6. **Secrets:** the Kubernetes Secret as today, a `values-production.example.yaml`, and a CI check that no development value survives in the rendered
   chart.
7. **Configuration names:** Helm values `edge.host`, `edge.tlsSecretName`, `edge.redirectToHttps`, `edge.hsts.maxAge`, `oidc.issuerUrl` (the identity host plus
   `/realms/elysion`); the realm's placeholders `ELYSION_APP_URL` and `ELYSION_BFF_CLIENT_SECRET`. Documented in `docs/specs/gateway.md` and
   `docs/self-hosting.md`.

## Rejected options

- **A production compose overlay with ACME in Traefik and required-secret variables:** drafted first, dropped on the owner's answer. A single-host
  compose production would be a second production target to build, document and keep secure (its Docker socket, its backup, its upgrades) for a use that
  is not planned.
- **A (a path of the app host):** a build-time option of Keycloak and a prefix that every redirect, asset and the frontend's authority must honour; the
  one benefit (same origin) is available with sibling subdomains.
- **ACME inside the chart:** a certificate lifecycle the chart cannot observe; cert-manager is the cluster's tool for it.
- **Two realm files kept by hand:** they diverge.
- **HSTS with `includeSubDomains` and `preload` from the start:** not reversible, and Elysion does not own the rest of an operator's domain.
- **Exposing the admin console with a firewall rule in front of it:** one wrong rule is a public administrator login; not routing it is the safer default.

## Consequences

- **#673 and its tasks #674 to #676 are written for a compose overlay and have to be rewritten after this ADR is accepted** (the issue says so itself).
  The work becomes: the chart's `websecure`, redirect and HSTS resources and `values-production.example.yaml`; `scripts/build-realm.mjs` with its test and
  the release asset; the rendered-chart check in CI; and a self-hosting guide around Kubernetes (prerequisites: a cluster, Traefik, cert-manager, a
  Postgres, a Valkey, an S3 store and a Keycloak; the steps; updating by `image.tag`; rotating a secret) with the compose part reduced to "the demo".
  #677 (the security review) and #680 (headers and CSP) use the host names decided here (the CSP allows the identity host for `connect-src` and
  `form-action`).
- The frontend's authority and every service's `OIDC_ISSUER_URL` are set from `oidc.issuerUrl`; the demo's value does not change.
- Entra's redirect URI is `https://<identity host>/realms/elysion/broker/entra/endpoint` (ADR 0027).
- A deployment has two host names and two certificates (or one wildcard), and **Keycloak is the operator's to run, back up and upgrade**: the guide
  says so, with the realm and the settings as the part Elysion owns.
- `docs/specs/gateway.md` gets a "TLS" section and `docs/self-hosting.md` links this ADR from "What a real deployment needs".

## Questions for the owner (answered)

- ~~Is there a domain to design against?~~ **Owner answer (2026-10-09): no.** The guide and `values-production.example.yaml` use `elysion.example` and `id.example`; an operator replaces them.
- ~~Who runs the production Keycloak?~~ **Owner answer (2026-10-09): not known yet.** Elysion's work is the same either way (the realm release asset, the documented Keycloak settings and the ingress rules). The guide therefore shows the Keycloak Operator as **one example** and says plainly that an existing Keycloak or another provider works the same; it does not pick one.

## Follow-ups the owner asked about (2026-10-10)

- **A wildcard certificate is enough.** One certificate for `*.elysion.example` serves the application host and the identity host (sibling subdomains,
  see above); it is the cluster's cert-manager (DNS-01) or the operator's PKI that makes it, and the same `kubernetes.io/tls` Secret can be named by
  `edge.tlsSecretName` and by the Keycloak ingress. The guide uses it as its example.
- **Keycloak as an optional part of the chart** is possible and does not change this decision (the chart takes an issuer URL either way), but it
  reverses ADR 0018 ("external services are values, never subcharts") and adds a service to run: its own database, backup, upgrades, the admin
  bootstrap, the realm import with the placeholders above and high availability. It is therefore a **separate PBI with its own ADR** (a
  `keycloak.enabled` switch, off by default) that supersedes that part of ADR 0018. #673 builds the realm import so that the PBI can use it unchanged.
- **Microsoft Entra ID without Keycloak** is variant B of [ADR 0027](0027-enterprise-sign-in-groups-and-administration.md) (direct); it is not
  decided here and needs no change to this ADR, because the chart and the realm file only depend on an issuer URL. It is decided with #638.

## Decision

_Accepted by the product owner on 2026-10-10 as written under "Decision (proposed)", with the follow-ups above. `needs-decision` is removed from #672; #673 is rewritten for the Helm chart._
