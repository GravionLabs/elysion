# ADR 0018: Kubernetes packaging: Kustomize or a Helm chart

- Status: Accepted (option B, Helm)
- Date: 2026-10-06
- Issues: #356 (Feature #30, PBI #355)
- Builds on: [ADR 0001](0001-gateway-and-bff.md), [ADR 0006](0006-shared-local-infrastructure.md), [ADR 0014](0014-keycloak-identity-provider.md)

## Context

The services run only in the dev compose stack. Feature #30 asks for manifests for the four application services
(frontend, BFF, realtime, business backend) and an ingress with the routes of the dev Traefik, deployable to a local
`kind` cluster. The packaging format has to be chosen first; the manifests are written in it.

What is to be packaged:

- **Four small stateless Deployments**, each with a Service, probes on its health endpoint, resource requests and a
  handful of environment variables (ports 80 / 3000 / 3000 / 8080; see `infra/docker/docker-compose.yml`).
- **External services are not bundled:** Postgres, Valkey, the object store (RustFS) and Keycloak are given as
  connection settings (host, port, credentials), because in a real cluster they are managed services or run by someone
  else. The manifests only point at them.
- **Edge configuration is Traefik-specific:** forwardAuth to the BFF, the CORS and rate-limit middlewares (#344) and
  the three routes (`/api`, `/yjs`, `/`) become Traefik `Middleware` and `IngressRoute` resources (or an `Ingress`
  with annotations); that is plain YAML either way.
- **Secrets:** `WS_TOKEN_SECRET` (BFF and realtime, the same value), `INTERNAL_API_SECRET` (realtime and business
  backend, the same value, different from the first), the Postgres connection string, Keycloak settings. Dev values
  must not be the production values, and no secret may be committed.
- **Environments:** at least a local `kind` cluster (needed for the check in #358) and one shared environment; they
  differ in host name, replica counts, origins for CORS, resource sizes and the external service addresses.

## Options

**A. Kustomize (plain manifests in `infra/k8s/base` with overlays per environment).** Built into
`kubectl` (`kubectl apply -k`, `kubectl kustomize`), no templating language: the manifests are valid Kubernetes YAML
that can be read, linted and applied as they are. Differences between environments are patches, `configMapGenerator`
and `images` entries. Secrets: the base refers to Secret names only; an overlay creates them with `secretGenerator`
from files that are not committed (local) or, in a shared environment, the Secrets come from a secret operator
(External Secrets, Sealed Secrets or SOPS), which Kustomize does not care about.

**B. A Helm chart (`infra/helm/elysion`).** Templates and `values.yaml`, `helm install/upgrade/rollback` with release
history, a de-facto standard for distributing software to others, `helm lint` and `helm template` for checks. Costs: a
templating language over YAML (indentation helpers, `if`/`range` in manifests), values that are a second API to design
and document, Go-template errors that are harder to read than a YAML patch. Secrets: values or `existingSecret`
references; the same operator options as A.

**C. Both** (a chart for outsiders, Kustomize for ourselves): double maintenance for a PoC; not considered further.

| Criterion                                  | A: Kustomize                                       | B: Helm chart                                           |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| Fits four services and two environments    | Yes: base plus two small overlays                  | Yes, but a chart and a values file for little variance  |
| Readability of what is applied             | The manifests are the source                       | Rendered output differs from the source                 |
| Tooling to install                         | None beyond `kubectl`                              | `helm`                                                  |
| Environment differences                    | Patches, generators                                | Values, conditionals                                    |
| Release history and rollback               | Not built in (Git, or Argo CD / Flux)              | Built in (`helm rollback`)                              |
| Distribution to third parties              | Possible (a remote base), less common              | The usual way                                           |
| Secrets without committing them            | `secretGenerator` from local files, or an operator | `existingSecret` or an operator                         |
| Traefik `Middleware` / `IngressRoute` CRDs | Plain YAML                                         | Plain YAML inside templates                             |
| Check before deploying                     | `kubectl apply -k ... --dry-run=client`            | `helm lint`, `helm template \| kubectl apply --dry-run` |

## Recommendation (not followed)

**Option A, Kustomize.** The deployment is four small services with few environment differences, no one outside the
project installs it, and the base manifests stay ordinary YAML that the dry-run check in the issue applies directly.
Helm's strengths (release history, a values contract for outsiders) are not needed now, and a rollback story can come
from Git and a GitOps tool later. If the project is ever distributed to third parties, a chart can be generated
from the same manifests; going the other way (from a chart back to plain manifests) is harder.

Consequences if accepted:

- Manifests live in `infra/k8s/base` (one directory, one file per service plus the edge resources) and
  `infra/k8s/overlays/kind` (local cluster: NodePort or `kind` ingress mapping, dev secrets generated from untracked
  files, small resources); a shared environment gets its own overlay when there is one.
- External services appear as ConfigMap / Secret keys with documented names (`POSTGRES_*`, `REDIS_URL`, `OIDC_*`),
  never as bundled StatefulSets.
- No secret is committed: the overlay for `kind` generates them from files listed in `.gitignore`, and the README of
  `infra/k8s` says which keys have to exist and that `WS_TOKEN_SECRET` and `INTERNAL_API_SECRET` must differ.
- CI can validate with `kubectl kustomize infra/k8s/overlays/kind | kubectl apply --dry-run=client -f -`.

## Decision

**Option B, a Helm chart** (the owner's decision, 2026-10-06), instead of the recommended Kustomize. The reasons the
owner gave are not recorded here; the trade-offs above stand. What follows from it:

- The chart lives in `infra/helm/elysion`: one `values.yaml` for the shared defaults, `values-kind.yaml` for the local
  cluster, a template per service (Deployment, Service, probes, resources) and one for the edge (Traefik `Middleware`
  and `IngressRoute`, or a plain `Ingress` when the controller is not Traefik).
- External services (Postgres, Valkey, object store, Keycloak) are values (`externalServices.*`), never subcharts.
- **Secrets are never in the chart's values files that are committed.** Each secret is referenced by name
  (`secrets.existingSecret` per service, keys documented in the chart README); the `kind` check creates them with
  `kubectl create secret` from untracked files, a shared environment from its secret operator. The chart can also
  render a Secret from values for throwaway installs, off by default. `WS_TOKEN_SECRET` and `INTERNAL_API_SECRET`
  must differ.
- Checks: `helm lint`, and `helm template ... | kubectl apply --dry-run=client -f -` (CI can run both).
- Release history and rollback come from Helm (`helm upgrade --install`, `helm rollback`).
