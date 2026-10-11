#!/bin/sh
# Writes the response headers of the frontend for nginx to include (run by the image's entrypoint before nginx starts;
# docs/specs/frontend.md, "Headers"). The Content-Security-Policy names the identity provider's origin, so it is made
# here from OIDC_ISSUER_URL, the variable that feeds auth-config.json, and not fixed in the image.
#
#   CSP_MODE         off | report | enforce (default enforce). `report` sends Content-Security-Policy-Report-Only: the
#                    browser reports a violation to the BFF (POST /api/csp-report, logged) and blocks nothing.
#   HSTS_MAX_AGE     seconds for Strict-Transport-Security; empty or 0 sends none (set it only when TLS is on).
#   KEYCLOAK_ORIGIN  the identity provider's origin when it is not the one of OIDC_ISSUER_URL.
set -eu

target="${HEADERS_TARGET:-/etc/nginx/conf.d/security-headers.inc}"
mode="${CSP_MODE:-enforce}"
issuer="${OIDC_ISSUER_URL:-}"
idp="${KEYCLOAK_ORIGIN:-$(printf '%s' "$issuer" | sed -n -E 's#^(https?://[^/?\#]+).*#\1#p')}"

case "$mode" in
  off | report | enforce) ;;
  *)
    echo "CSP_MODE must be off, report or enforce, not '$mode'" >&2
    exit 1
    ;;
esac
case "$idp" in
  *[\;\"\'\ ]*)
    echo "KEYCLOAK_ORIGIN / OIDC_ISSUER_URL holds a character that does not belong into an origin" >&2
    exit 1
    ;;
esac

{
  # The plain headers: on every response.
  echo 'add_header X-Content-Type-Options "nosniff" always;'
  echo 'add_header Referrer-Policy "no-referrer" always;'
  echo 'add_header X-Frame-Options "DENY" always;'
  echo 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;'
  echo 'add_header Cross-Origin-Opener-Policy "same-origin" always;'
  # The same URL answers in the language of the cookie or of Accept-Language, so a cache must tell them apart.
  echo 'add_header Vary "Accept-Language, Cookie" always;'
  if [ "${HSTS_MAX_AGE:-0}" != "0" ] && [ -n "${HSTS_MAX_AGE:-}" ]; then
    echo "add_header Strict-Transport-Security \"max-age=${HSTS_MAX_AGE}; includeSubDomains\" always;"
  fi
  if [ "$mode" != "off" ]; then
    policy="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${idp} https://libraries.excalidraw.com https://raw.githubusercontent.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' ${idp}; report-uri /api/csp-report; report-to csp"
    header=Content-Security-Policy
    [ "$mode" = "report" ] && header=Content-Security-Policy-Report-Only
    echo "add_header ${header} \"${policy}\" always;"
    echo 'add_header Reporting-Endpoints "csp=\"/api/csp-report\"" always;'
  fi
} >"$target"
