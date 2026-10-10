#!/usr/bin/env bash
# With arguments (`docker compose run --rm backup backup.sh`) it runs them. Without, it is the scheduler: a crontab
# line made from BACKUP_CRON that runs backup.sh, with busybox crond.
set -euo pipefail

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

cron="${BACKUP_CRON:-0 3 * * *}"
mkdir -p /etc/crontabs "${BACKUP_PATH:-/backups}"
# cron starts jobs with an empty environment: the settings are written to a file the job reads (single quotes made safe).
env | grep -E '^(PG|BACKUP_|S3_|TZ=)' | while IFS='=' read -r name value; do
  printf "export %s='%s'\n" "$name" "$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
done > /etc/backup.env
# The job's output goes to the container's log (pid 1), where the alerting of #687 reads the `backup ok` line.
echo "$cron . /etc/backup.env; /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "backup scheduled: ${cron} (keeping ${BACKUP_KEEP_DAYS:-14} days in ${BACKUP_PATH:-/backups})"
exec crond -f -l 8
