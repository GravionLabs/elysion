#!/usr/bin/env bash
# The rehearsal that makes the backup trustworthy (docs/self-hosting.md, "Back up and restore"): on a running stack it
# makes two boards (one with an image), takes a backup, destroys the databases and the bucket's files, restores, and checks
# that the boards and the image are back. Used by the container workflow; run it by hand on a stack you can lose data in:
#   bash scripts/backup-rehearsal.sh [http://localhost] [http://localhost:8081]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-http://localhost}"
KEYCLOAK="${2:-http://localhost:8081}"
compose=(docker compose --profile backup)
fail() { echo "FAIL  $*" >&2; exit 1; }

token() {
  curl -s "$KEYCLOAK/realms/elysion/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=elysion-frontend -d "username=$1" -d "password=$1" \
    | { grep -o '"access_token":"[^"]*"' || true; } | cut -d'"' -f4
}
make_board() {
  curl -s -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"name\":\"$2\"}" "$APP/api/boards" \
    | { grep -o '"id":"[^"]*"' || true; } | head -1 | cut -d'"' -f4
}

t="$(token dev1)"
[ -n "$t" ] || fail "dev1 cannot log in"
a="$(make_board "$t" 'Rehearsal A')"
b="$(make_board "$t" 'Rehearsal B')"
if [ -z "$a" ] || [ -z "$b" ]; then fail "the boards could not be made"; fi
echo "ok  two boards made ($a, $b)"

# A 1x1 PNG on board A: the object store is part of the backup.
png=iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
file=0123456789abcdef0123456789abcdef01234567
printf '%s' "$png" | base64 -d > /tmp/rehearsal.png
code="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $t" -H 'Content-Type: image/png' \
  --data-binary @/tmp/rehearsal.png "$APP/api/boards/$a/files/$file")"
[ "$code" = 204 ] || fail "the image was not stored ($code)"
echo "ok  an image stored on board A"

out="$("${compose[@]}" run --rm backup backup.sh)"
echo "$out"
echo "$out" | tail -1 | grep -q '^backup ok ' || fail "the backup did not say ok"
echo "ok  backup made"

echo "destroying the databases and the files"
"${compose[@]}" stop business-backend realtime bff keycloak
for db in elysion keycloak; do
  "${compose[@]}" exec -T postgres psql -U elysion -d postgres -c "drop database \"$db\" with (force)" >/dev/null
done
# The variables are the container's, not this shell's: single quotes on purpose.
# shellcheck disable=SC2016
"${compose[@]}" run --rm --no-deps --entrypoint bash backup -c \
  '. /usr/local/bin/s3env.sh && rclone purge ":s3:${S3_BUCKET}" --quiet'
echo "ok  everything destroyed"

bash scripts/restore.sh latest
echo "ok  restored"

for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$KEYCLOAK/realms/elysion")" = 200 ] && \
    [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(token dev1)" "$APP/api/boards")" = 200 ] && break
  sleep 2
done

t="$(token dev1)"
[ -n "$t" ] || fail "dev1 cannot log in after the restore"
boards="$(curl -s -H "Authorization: Bearer $t" "$APP/api/boards")"
for name in 'Rehearsal A' 'Rehearsal B'; do
  echo "$boards" | grep -q "\"name\":\"$name\"" || fail "$name is not back after the restore: $boards"
done
echo "ok  both boards are back"

curl -s -H "Authorization: Bearer $t" "$APP/api/boards/$a/files/$file" -o /tmp/rehearsal-back.png
cmp -s /tmp/rehearsal.png /tmp/rehearsal-back.png || fail "the image is not back"
echo "ok  the image is back"

for id in "$a" "$b"; do
  curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $t" "$APP/api/boards/$id"
done
echo "The backup works: a restore brings the boards and the image back."
