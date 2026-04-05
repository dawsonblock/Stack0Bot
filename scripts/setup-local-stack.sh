#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd npm "Install Node.js and npm, then retry."

if [[ -z "${OMLX_MODEL_DIR:-}" ]]; then
	echo "Warning: OMLX_MODEL_DIR is not set. Setup can complete, but ./scripts/start-stack.sh, npm run smoke, and npm run verify:live require it." >&2
fi

echo "Installing root workspace dependencies"
(cd "$ROOT_DIR" && npm install)

"$ROOT_DIR/scripts/setup-omlx.sh"
"$ROOT_DIR/scripts/setup-runtime-gateway.sh"

echo "Building the core TypeScript workspace"
(cd "$ROOT_DIR" && npm run build)

echo "Local stack setup completed"