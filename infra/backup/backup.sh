#!/usr/bin/env bash
# One backup run: pg_dump of the databases (custom format, compressed) and a copy of the object store's bucket, into
# BACKUP_PATH/<UTC timestamp>/, then the runs older than BACKUP_KEEP_DAYS are removed. The last line says how it went:
#   backup ok <directory> <bytes>      or      backup FAILED: <why>
# `<BACKUP_PATH>/last-success` holds the epoch seconds of the last good run, for a check that does not read logs.
# Needs PGHOST, PGUSER and PGPASSWORD (the libpq variables); S3_* for the files unless BACKUP_FILES=false.
set -euo pipefail

BACKUP_PATH="${BACKUP_PATH:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
BACKUP_DATABASES="${BACKUP_DATABASES:-elysion keycloak}"
BACKUP_FILES="${BACKUP_FILES:-true}"

fail() {
  echo "backup FAILED: $*" >&2
  exit 1
}
trap 'fail "the command on line $LINENO failed"' ERR

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_PATH/$stamp"
mkdir -p "$target"

for database in $BACKUP_DATABASES; do
  echo "dumping $database"
  pg_dump --format=custom --compress=6 --no-owner --file="$target/$database.dump" "$database"
done

if [ "$BACKUP_FILES" = "true" ]; then
  : "${S3_ENDPOINT:?S3_ENDPOINT is needed for the files (or set BACKUP_FILES=false)}"
  echo "copying the bucket ${S3_BUCKET:-elysion-files}"
  mkdir -p "$target/files"
  # shellcheck source=s3env.sh
  . "$(dirname "$0")/s3env.sh"
  rclone sync ":s3:${S3_BUCKET:-elysion-files}" "$target/files" --quiet
fi

# What the restore reads first: the directory of the newest good run.
ln -sfn "$stamp" "$BACKUP_PATH/latest"
date -u +%s > "$BACKUP_PATH/last-success"

# A run is removed when it is older than the retention; the one just made never is.
find "$BACKUP_PATH" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_KEEP_DAYS" ! -name "$stamp" -exec rm -rf {} +

bytes="$(du -sb "$target" | cut -f1)"
trap - ERR
echo "backup ok $target $bytes"
