
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd node
require_file "$ROOT_DIR/services/run-api/dist/server.js" "Run npm run build from the repo root before starting the Run API."

export AGENT_STACK_BASE_DIR="${AGENT_STACK_BASE_DIR:-$ROOT_DIR}"
export AGENT_STACK_RUN_API_PORT="${AGENT_STACK_RUN_API_PORT:-8788}"
exec node "$ROOT_DIR/services/run-api/dist/server.js"
