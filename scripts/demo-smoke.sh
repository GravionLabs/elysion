#!/usr/bin/env bash
# Checks that a running Elysion stack (the demo, `pnpm demo`, or the development stack) works end to end: the app is
# served, the identity provider is up, the three demo users can log in, the API answers for a signed-in user and
# refuses an anonymous one, a board can be made and a realtime token for it issued. Used by the container workflow;
# run it by hand with `bash scripts/demo-smoke.sh [http://localhost] [http://localhost:8081]`.
set -euo pipefail

APP="${1:-http://localhost}"
KEYCLOAK="${2:-http://localhost:8081}"
fail() { echo "FAILED: $*" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() { # expect <code> <what> <curl args...>
  local want="$1" what="$2"; shift 2
  local got
  got="$(status "$@")"
  # A service that was just started or replaced can answer 502/503/504 for a few seconds (its first requests fetch keys, open
  # connections): ask again before calling it a failure.
  for _ in 1 2 3 4 5 6 7 8; do
    case "$got" in 502|503|504) [ "$want" = "$got" ] || { sleep 4; got="$(status "$@")"; } ;; *) break ;; esac
  done
  [ "$got" = "$want" ] || fail "$what: expected $want, got $got"
  echo "ok  $what"
}

# Wait for the stack (the images were just built and started).
for _ in $(seq 1 90); do
  [ "$(status -H 'Accept: text/html' "$APP/")" = 200 ] && [ "$(status "$KEYCLOAK/realms/elysion")" = 200 ] && break
  sleep 2
done

expect 200 "the app is served" -H 'Accept: text/html' "$APP/"
expect 200 "the identity provider has the realm" "$KEYCLOAK/realms/elysion"
expect 401 "the API refuses an anonymous request" "$APP/api/boards"

# The security headers (#681): on the app and on the API's answers, even a 401; the report endpoint takes a report without a token.
has_header() { # has_header <header> <what> <curl args...>
  local header="$1" what="$2"; shift 2
  curl -s -D - -o /dev/null "$@" | grep -qi "^$header:" || fail "$what: no $header header"
  echo "ok  $what"
}
for header in Content-Security-Policy X-Content-Type-Options Permissions-Policy Cross-Origin-Opener-Policy; do
  has_header "$header" "the app sends $header" "$APP/"
done
for header in X-Content-Type-Options Permissions-Policy Cross-Origin-Opener-Policy; do
  has_header "$header" "the API sends $header" "$APP/api/boards"
done
expect 204 "the CSP report endpoint takes a report without a token" -X POST -H 'Content-Type: application/csp-report' \
  -d '{"csp-report":{"effective-directive":"img-src","blocked-uri":"inline"}}' "$APP/api/csp-report"

token() {
  curl -s "$KEYCLOAK/realms/elysion/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=elysion-frontend -d "username=$1" -d "password=$1" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
}

for user in dev dev1 dev2; do
  t="$(token "$user")"
  [ -n "$t" ] || fail "$user cannot log in"
  expect 200 "$user lists boards" -H "Authorization: Bearer $t" "$APP/api/boards"
done

t="$(token dev1)"
board="$(curl -s -H "Authorization: Bearer $t" -H 'Content-Type: application/json' -d '{"name":"Smoke test"}' "$APP/api/boards")"
id="$(printf '%s' "$board" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
[ -n "$id" ] || fail "a board could not be made: $board"
echo "ok  dev1 made a board ($id)"
expect 200 "a realtime token is issued for it" -H "Authorization: Bearer $t" -H 'Content-Type: application/json' \
  -d "{\"boardId\":\"$id\"}" "$APP/api/realtime/token"
expect 204 "the board can be deleted" -X DELETE -H "Authorization: Bearer $t" "$APP/api/boards/$id"
echo "The stack works."
