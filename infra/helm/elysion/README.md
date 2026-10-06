# Elysion Helm chart

Deploys the four application services (frontend, BFF, realtime, business backend) and, for Traefik, the edge resources
(`Middleware` for forwardAuth, CORS and the rate limit, and one `IngressRoute` with the routes of the dev stack:
`/api`, `/yjs`, `/`). Decision and reasoning: [ADR 0018](../../../docs/adr/0018-kubernetes-packaging.md).

**Not in the chart:** Postgres, Valkey, the object store and Keycloak. They are external services; the chart only
needs their addresses, and the passwords are in a Secret you provide. The Traefik controller (with its CRDs) has to
be installed in the cluster.

```sh
helm upgrade --install elysion infra/helm/elysion -n elysion \
  -f infra/helm/elysion/values-kind.yaml       # or your own values file
helm lint infra/helm/elysion -f infra/helm/elysion/values-kind.yaml
```

## Values you have to set

| Value                     | Meaning                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `oidc.issuerUrl`          | The Keycloak realm URL **as it appears in the tokens** (what the browser logs in at). Required.      |
| `oidc.jwksUri`            | Where the services fetch the realm's keys, when that differs from the issuer (cluster-internal URL). |
| `images.*`                | Repository, tag and pull policy of the four images (built from the repository's Dockerfiles).        |
| `edge.host`               | Host name the routes answer for (empty: any).                                                        |
| `edge.corsAllowedOrigins` | Origins that get CORS headers on `/api` and `/yjs`.                                                  |
| `secrets.existingSecret`  | Name of the Secret below (default `elysion-secrets`).                                                |

Everything else (replicas, resources, rate limit, entry points, TLS secret) has a default in `values.yaml`.

## The Secret

No secret is ever a value of a committed file. Create the Secret yourself (or let your secret operator create it):

```sh
kubectl -n elysion create secret generic elysion-secrets \
  --from-literal=WS_TOKEN_SECRET="$(openssl rand -hex 32)" \
  --from-literal=INTERNAL_API_SECRET="$(openssl rand -hex 32)" \
  --from-literal=POSTGRES_CONNECTION_STRING='Host=...;Port=5432;Database=elysion;Username=...;Password=...' \
  --from-literal=REDIS_URL='redis://valkey.example:6379'
```

`WS_TOKEN_SECRET` (BFF and realtime) and `INTERNAL_API_SECRET` (realtime and business backend) are different values of
at least 32 characters. For a throwaway install `secrets.create=true` renders the Secret from `secrets.values`; those
values then sit in the Helm release, so do not use it for anything that matters.

## Notes

- The services' probes are `/health` (frontend: `/`). The business backend applies its migrations itself at start
  (`migrateOnStartup`).
- More than one realtime replica is fine: rooms are kept in step through Valkey, no sticky sessions needed.
- `/metrics` of the BFF and realtime are on the services' ports inside the cluster and are not routed by the edge.
- Try it locally with a `kind` cluster: [infra/kind](../../kind/README.md).
