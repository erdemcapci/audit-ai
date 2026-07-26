#!/usr/bin/env bash
set -euo pipefail

public_checkout="${1:-}"
if [[ -z "$public_checkout" || ! -d "$public_checkout/.git" ]]; then
  echo "Usage: $0 /path/to/audit-ai" >&2
  echo "Pass a checkout of erdemcapci/audit-ai at main." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shared_paths=(
  frontend/src/screens/AuditWorkspace.tsx
  frontend/src/panels/DetailPanel.tsx
  frontend/src/flow
)
status=0

for path in "${shared_paths[@]}"; do
  if ! diff -qr "$public_checkout/$path" "$repo_root/$path"; then
    status=1
  fi
done

# global.css contains both shared application styles and hosted-shell styles. Limit
# this check to selectors that implement the public Canvas interaction.
canvas_selectors='canvas-workspace|canvas-overlay-inspector|canvas-overlay-close|workspace-grid-map'
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
extract_canvas_styles() {
  awk -v pattern="$canvas_selectors" '
    $0 ~ "^(\\." pattern ")" { capture=1 }
    capture { print }
    capture && /^}/ { capture=0 }
  ' "$1/frontend/src/styles/global.css"
}
extract_canvas_styles "$public_checkout" > "$tmp_dir/public.css"
extract_canvas_styles "$repo_root" > "$tmp_dir/showcase.css"
if ! diff -u "$tmp_dir/public.css" "$tmp_dir/showcase.css"; then
  status=1
fi

if [[ "$status" -ne 0 ]]; then
  echo "Unexpected shared-file differences detected." >&2
  exit "$status"
fi
echo "Shared application files match the public checkout."
