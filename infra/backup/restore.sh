#!/usr/bin/env bash
# Restores a backup made by backup.sh into the running Postgres and object store. Run it through scripts/restore.sh, which
# stops the services that use them first.
#   restore.sh <run directory or timestamp or "latest"> [--force]
# A database that has tables is not touched without --force (it is dropped and made again then); the bucket is
# made equal to the backup (files that are not in it are deleted) only with --force or when it is empty.
set -euo pipefail

BACKUP_PATH="${BACKUP_PATH:-/backups}"
BACKUP_DATABASES="${BACKUP_DATABASES:-elysion keycloak}"
run="${1:?usage: restore.sh <run directory|timestamp|latest> [--force]}"
force=false
[ "${2:-}" = "--force" ] && force=true

case "$run" in
  /*) dir="$run" ;;
  *) dir="$BACKUP_PATH/$run" ;;
esac
dir="$(readlink -f "$dir")"
[ -d "$dir" ] || { echo "no such backup: $dir" >&2; exit 1; }

psql_admin() { psql --no-psqlrc --quiet --tuples-only --no-align --dbname=postgres "$@"; }

for database in $BACKUP_DATABASES; do
  [ -f "$dir/$database.dump" ] || { echo "$dir has no $database.dump" >&2; exit 1; }
done

for database in $BACKUP_DATABASES; do
  exists="$(psql_admin --command "select 1 from pg_database where datname = '$database'")"
  if [ "$exists" = "1" ]; then
    tables="$(psql --no-psqlrc --quiet --tuples-only --no-align --dbname="$database" --command "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')")"
    if [ "$tables" != "0" ] && [ "$force" != "true" ]; then
      echo "the database $database has $tables tables; it is not touched without --force" >&2
      exit 1
    fi
    if [ "$tables" != "0" ]; then
      echo "dropping $database (--force)"
      psql_admin --command "drop database \"$database\" with (force)"
      exists=""
    fi
  fi
  if [ "$exists" != "1" ]; then
    echo "creating $database"
    psql_admin --command "create database \"$database\""
  fi
  echo "restoring $database from $dir/$database.dump"
  pg_restore --no-owner --exit-on-error --dbname="$database" "$dir/$database.dump"
done

if [ -d "$dir/files" ] && [ -n "${S3_ENDPOINT:-}" ]; then
  # shellcheck source=s3env.sh
  . "$(dirname "$0")/s3env.sh"
  bucket=":s3:${S3_BUCKET:-elysion-files}"
  # A bucket that is gone (the usual disaster) is as empty as one without files: `rclone lsf` fails on it.
  present="$({ rclone lsf --max-depth 1 "$bucket" 2>/dev/null || true; } | wc -l)"
  if [ "$present" != "0" ] && [ "$force" != "true" ]; then
    echo "the bucket ${S3_BUCKET:-elysion-files} is not empty; it is not touched without --force" >&2
    exit 1
  fi
  echo "restoring the bucket ${S3_BUCKET:-elysion-files}"
  rclone mkdir "$bucket"
  rclone sync "$dir/files" "$bucket" --quiet
fi
echo "restore ok from $dir"
