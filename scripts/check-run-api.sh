
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd curl
require_cmd python3

RUN_API_URL="${AGENT_STACK_RUN_API_URL:-http://127.0.0.1:8788}"

echo "Checking Run API at $RUN_API_URL"
healthz_payload=$(curl -fsS "$RUN_API_URL/healthz")
runs_payload=$(curl -fsS "$RUN_API_URL/v1/runs")

printf '== %s ==\n' "$RUN_API_URL/healthz"
printf '%s' "$healthz_payload" | print_json
printf '\n== %s ==\n' "$RUN_API_URL/v1/runs"
printf '%s' "$runs_payload" | print_json
