# Elysion on a local kind cluster

Deploys the Helm chart ([infra/helm/elysion](../helm/elysion/README.md), [ADR 0018](../../docs/adr/0018-kubernetes-packaging.md))
to a `kind` cluster and serves it at <http://localhost>, so two browsers can sync on one board through the ingress.

```sh
pnpm dev:stack:down    # frees host port 80 (the compose stack's Traefik)
KEYCLOAK_BIND=0.0.0.0 DEV_BIND=0.0.0.0 pnpm dev:infra   # Postgres, Keycloak and RustFS, which the cluster uses as its external services
                       # (Keycloak, Postgres and RustFS must listen on all interfaces: the pods reach them through the host's address)
pnpm kind:up           # builds the four images, creates the cluster, installs Traefik, a Valkey and the chart
# open http://localhost  (log in as dev / dev), create a board, open it in two windows
pnpm kind:down         # deletes the cluster
```

Needs `docker`, [`kind`](https://kind.sigs.k8s.io), `kubectl`, `helm` (set `KIND=/path/to/kind` if it is not on the path).

What the script does (`deploy.sh`):

1. Creates the cluster `elysion` (`kind-config.yaml`: host port 80 is mapped to the node, where Traefik listens).
2. Builds `elysion/{frontend,bff,realtime,business-backend}:kind` and loads them into the cluster.
3. Installs Traefik (`traefik-values.yaml`: JSON access log without query strings, CRDs enabled).
4. Provides the external services: a database `elysion_kind` in the compose stack's Postgres, the compose stack's
   Keycloak (the tokens carry the issuer `http://localhost:8081/...`, the cluster reaches the keys through the host's
   address on the `kind` network), the compose stack's RustFS as the object store of board files (bucket `elysion-files-kind`) and a throwaway Valkey in the namespace `elysion-external` (`valkey.yaml`).
5. Generates the Secret `elysion-secrets` with random secrets (not committed, not printed) and installs the chart with
   `values-kind.yaml`.

Re-running `kind:up` rebuilds the images and restarts the pods. Scale the realtime service to try two replicas:
`helm upgrade elysion infra/helm/elysion -n elysion -f infra/helm/elysion/values-kind.yaml --reuse-values --set replicas.realtime=2`.
