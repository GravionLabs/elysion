#!/usr/bin/env bash
# No development value may reach a production release (ADR 0028): the chart rendered with the production example must not contain
# any value the demo stack uses. The values are the ones docker-compose.yml and the dev realm define.
#   infra/helm/check-no-dev-values.sh [values-file ...]    (default: the production example)
set -euo pipefail
cd "$(dirname "$0")"

files=("$@")
[ ${#files[@]} -gt 0 ] || files=(elysion/values-production.example.yaml)
pattern='admin/admin|dev-only-|elysion123|elysion-bff-dev-secret|localhost'

args=()
for f in "${files[@]}"; do args+=(-f "$f"); done
if helm template elysion elysion "${args[@]}" --namespace elysion | grep -n -E "$pattern"; then
  echo "A development value is in the chart rendered with ${files[*]} (matches above)." >&2
  exit 1
fi
echo "No development value in the rendering of ${files[*]}."
