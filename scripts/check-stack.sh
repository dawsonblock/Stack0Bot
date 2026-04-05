#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd curl
require_cmd python3

OMLX_BASE_URL="${OMLX_BASE_URL:-http://127.0.0.1:8000}"
GATEWAY_URL="${GSD_RUNTIME_GATEWAY_URL:-http://127.0.0.1:8787}"
RUN_API_URL="${AGENT_STACK_RUN_API_URL:-http://127.0.0.1:8788}"
TOKEN="${GSD_RUNTIME_GATEWAY_BEARER:-}"
GATEWAY_AUTH=()
if [[ -n "$TOKEN" ]]; then
	GATEWAY_AUTH=(-H "authorization: Bearer $TOKEN")
fi

check_json_endpoint() {
	local label="$1"
	local url="$2"
	shift 2
	local payload
	if ! payload=$(curl -fsS "$@" "$url"); then
		echo "Failed to fetch $label from $url" >&2
		exit 1
	fi

	printf '== %s ==\n' "$label"
	printf '%s' "$payload" | print_json
	echo
}

check_json_endpoint "oMLX /v1/models" "$OMLX_BASE_URL/v1/models"
if [[ ${#GATEWAY_AUTH[@]} -gt 0 ]]; then
	check_json_endpoint "runtime-gateway /healthz" "$GATEWAY_URL/healthz" "${GATEWAY_AUTH[@]}"
	check_json_endpoint "runtime-gateway /v1/runtime/status" "$GATEWAY_URL/v1/runtime/status" "${GATEWAY_AUTH[@]}"
else
	check_json_endpoint "runtime-gateway /healthz" "$GATEWAY_URL/healthz"
	check_json_endpoint "runtime-gateway /v1/runtime/status" "$GATEWAY_URL/v1/runtime/status"
fi
check_json_endpoint "run-api /healthz" "$RUN_API_URL/healthz"
check_json_endpoint "run-api /v1/runs" "$RUN_API_URL/v1/runs"
