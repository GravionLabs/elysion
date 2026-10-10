#!/usr/bin/env bash
# The rendered chart as a test: `helm template` with each values file is compared with the committed copy in
# infra/helm/snapshots/, so a change to a template shows up in the pull request as a change to what the cluster gets.
#   infra/helm/snapshot.sh            fails when a rendering differs
#   infra/helm/snapshot.sh --update   writes the renderings (commit them)
set -euo pipefail
cd "$(dirname "$0")"

render() { helm template elysion elysion -f "elysion/$1" --namespace elysion; }
declare -A cases=([kind]=values-kind.yaml [production]=values-production.example.yaml)

status=0
for name in "${!cases[@]}"; do
  file="snapshots/$name.yaml"
  if [ "${1:-}" = "--update" ]; then
    mkdir -p snapshots
    render "${cases[$name]}" > "$file"
    echo "wrote $file"
  elif ! diff -u "$file" <(render "${cases[$name]}"); then
    echo "The chart rendered with ${cases[$name]} differs from $file: run infra/helm/snapshot.sh --update and commit it." >&2
    status=1
  fi
done
exit $status
