#!/usr/bin/env bash
# Deploys Elysion to a local kind cluster with the Helm chart (ADR 0018, infra/kind/README.md).
#   infra/kind/deploy.sh up      create the cluster, build and load the images, install everything
#   infra/kind/deploy.sh down    delete the cluster
# Needs: docker, kind, kubectl, helm; the compose infrastructure (`pnpm dev:infra`: Postgres, Keycloak, RustFS) running and
# nothing else on host port 80 (`pnpm dev:stack:down`).
set -euo pipefail

cd "$(dirname "$0")/../.."
CLUSTER=elysion
NAMESPACE=elysion
KIND=${KIND:-kind}
# The compose project's Postgres (`pnpm dev:infra` is project `elysion`).
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-elysion-postgres-1}
# More arguments for `helm upgrade --install`, for example `--set migrateJob.enabled=true` (CI uses it).
HELM_ARGS=${HELM_ARGS:-}
TAG=kind

up() {
  command -v "$KIND" >/dev/null || { echo "kind is not installed (https://kind.sigs.k8s.io)"; exit 1; }
  if ! "$KIND" get clusters | grep -qx "$CLUSTER"; then
    if ss -ltn | grep -q ':80 '; then
      echo "Host port 80 is in use (the compose stack's Traefik?). Stop it with: pnpm dev:stack:down"; exit 1
    fi
    "$KIND" create cluster --config infra/kind/kind-config.yaml
  fi
  kubectl config use-context "kind-$CLUSTER" >/dev/null

  echo "== images"
  docker build -q -t "elysion/frontend:$TAG" -f apps/frontend/Dockerfile .
  docker build -q -t "elysion/bff:$TAG" -f apps/bff/Dockerfile .
  docker build -q -t "elysion/realtime:$TAG" -f apps/realtime/Dockerfile .
  docker build -q -t "elysion/business-backend:$TAG" apps/business-backend
  for image in frontend bff realtime business-backend; do
    "$KIND" load docker-image "elysion/$image:$TAG" --name "$CLUSTER"
  done

  echo "== ingress controller"
  helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
  helm repo update traefik >/dev/null
  helm upgrade --install traefik traefik/traefik --namespace traefik --create-namespace \
    -f infra/kind/traefik-values.yaml --wait --timeout 6m

  echo "== external services (the host's Postgres, Keycloak and RustFS, a Valkey in the cluster)"
  # The kind nodes reach the host's published ports through the gateway of the docker network `kind`.
  HOST_IP=$(docker network inspect kind -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' | tr ' ' '\n' | grep -v ':' | head -1)
  # Fallback: the node's default route is the host (on a runner the network's Gateway can come back empty).
  [ -n "$HOST_IP" ] || HOST_IP=$(docker exec "$CLUSTER-control-plane" ip route | awk '/^default/ {print $3}')
  [ -n "$HOST_IP" ] || { echo "Cannot find the host's address as the kind nodes see it."; exit 1; }
  echo "the host as the nodes see it: $HOST_IP"
  docker exec "$POSTGRES_CONTAINER" psql -U elysion -d postgres -tc "select 1 from pg_database where datname='elysion_kind'" | grep -q 1 \
    || docker exec "$POSTGRES_CONTAINER" psql -U elysion -d postgres -c 'create database elysion_kind' >/dev/null
  kubectl create namespace elysion-external --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl apply -f infra/kind/valkey.yaml >/dev/null
  kubectl -n elysion-external rollout status deployment/valkey --timeout=120s

  echo "== secrets (generated now, never committed)"
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  if ! kubectl -n "$NAMESPACE" get secret elysion-secrets >/dev/null 2>&1; then
    kubectl -n "$NAMESPACE" create secret generic elysion-secrets \
      --from-literal=WS_TOKEN_SECRET="$(openssl rand -hex 32)" \
      --from-literal=INTERNAL_API_SECRET="$(openssl rand -hex 32)" \
      --from-literal=POSTGRES_CONNECTION_STRING="Host=$HOST_IP;Port=5432;Database=elysion_kind;Username=elysion;Password=elysion" \
      --from-literal=REDIS_URL="redis://valkey.elysion-external:6379" \
      --from-literal=S3_ACCESS_KEY="${S3_ACCESS_KEY:-elysion}" \
      --from-literal=S3_SECRET_KEY="${S3_SECRET_KEY:-elysion123}"
  fi

  echo "== elysion"
  helm upgrade --install elysion infra/helm/elysion --namespace "$NAMESPACE" \
    -f infra/helm/elysion/values-kind.yaml \
    --set "oidc.jwksUri=http://$HOST_IP:8081/realms/elysion/protocol/openid-connect/certs" \
    --set "objectStore.endpoint=http://$HOST_IP:${RUSTFS_S3_PORT:-9100}" \
    ${HELM_ARGS} \
    --wait --timeout 5m
  # An image rebuilt under the same tag is only picked up by a restart.
  kubectl -n "$NAMESPACE" rollout restart deployment >/dev/null
  kubectl -n "$NAMESPACE" rollout status deployment --timeout=180s >/dev/null 2>&1 || true
  kubectl -n "$NAMESPACE" get pods
  echo "Open http://localhost (log in as dev / dev)."
}

down() {
  "$KIND" delete cluster --name "$CLUSTER"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down"; exit 1 ;;
esac
