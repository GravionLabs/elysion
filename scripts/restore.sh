#!/usr/bin/env bash
# Restores a backup of the compose stack (docs/self-hosting.md, "Back up and restore"):
#   scripts/restore.sh <backup directory name, timestamp, or latest> [--force]
# It stops the services that use the databases and the bucket, restores them with the backup service's image, and starts
# the services again. It refuses to touch a database that has tables, or a bucket that is not empty, without --force.
set -euo pipefail
cd "$(dirname "$0")/.."

run="${1:?usage: scripts/restore.sh <backup directory|timestamp|latest> [--force]}"
shift
compose=(docker compose --profile backup)

echo "stopping the services that use the databases"
"${compose[@]}" stop business-backend realtime bff keycloak

status=0
"${compose[@]}" run --rm --no-deps backup restore.sh "$run" "$@" || status=$?

echo "starting the services again"
"${compose[@]}" up -d business-backend realtime bff keycloak
exit "$status"
