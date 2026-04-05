#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDORED_GSD="$ROOT_DIR/vendor/gsd-2-main"

if [[ ! -d "$VENDORED_GSD" ]]; then
  echo "vendored GSD tree not found: $VENDORED_GSD" >&2
  exit 1
fi

echo "The vendored tree already includes the runtime command patch set."
echo "Rebuild GSD from $VENDORED_GSD to make /gsd runtime available in a compiled distribution."
