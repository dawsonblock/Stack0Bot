#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd curl
require_cmd node
require_cmd python3

OMLX_PORT="${OMLX_PORT:-8000}"
GATEWAY_PORT="${GSD_RUNTIME_GATEWAY_PORT:-8787}"
RUN_API_PORT="${AGENT_STACK_RUN_API_PORT:-8788}"
OMLX_BASE_URL="http://127.0.0.1:${OMLX_PORT}"
GATEWAY_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}"
RUN_API_BASE_URL="http://127.0.0.1:${RUN_API_PORT}"

OMLX_VENV="$ROOT_DIR/vendor/omlx-main/.venv"
GATEWAY_VENV="$ROOT_DIR/services/runtime-gateway/.venv"
RUN_API_DIST="$ROOT_DIR/services/run-api/dist/server.js"
RUNTIME_CONFIG="$ROOT_DIR/services/runtime-gateway/runtime-config.yaml"
OMLX_MODEL_DIR="${OMLX_MODEL_DIR:-$HOME/models}"
LOG_DIR="$ROOT_DIR/storage/logs"

require_dir "$OMLX_MODEL_DIR" "Set OMLX_MODEL_DIR to a directory containing your local models before starting the stack."
require_file "$OMLX_VENV/bin/omlx" "Run ./scripts/setup-omlx.sh before starting the stack."
require_file "$GATEWAY_VENV/bin/uvicorn" "Run ./scripts/setup-runtime-gateway.sh before starting the stack."
require_file "$RUNTIME_CONFIG" "Run ./scripts/setup-runtime-gateway.sh to create runtime-config.yaml."
require_file "$RUN_API_DIST" "Run npm run build from the repo root before starting the stack."

mkdir -p "$LOG_DIR"
OMLX_LOG="$LOG_DIR/omlx.log"
GATEWAY_LOG="$LOG_DIR/runtime-gateway.log"
RUN_API_LOG="$LOG_DIR/run-api.log"

start_bg() {
  local pid_var_name="$1"
  local log_file="$2"
  shift 2
  "$@" >"$log_file" 2>&1 &
  printf -v "$pid_var_name" '%s' "$!"
}

cleanup() {
  local status=$?
  for pid in ${RUN_API_PID:-} ${GATEWAY_PID:-} ${OMLX_PID:-}; do
    if [[ -n "${pid:-}" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  exit "$status"
}

trap cleanup EXIT INT TERM

echo "Starting oMLX on $OMLX_BASE_URL"
start_bg OMLX_PID "$OMLX_LOG" "$OMLX_VENV/bin/omlx" serve --model-dir "$OMLX_MODEL_DIR" --port "$OMLX_PORT"
if ! wait_for_http "oMLX" "$OMLX_BASE_URL/v1/models" 60 1; then
  show_log_tail "$OMLX_LOG"
  exit 1
fi

echo "Starting runtime-gateway on $GATEWAY_BASE_URL"
start_bg GATEWAY_PID "$GATEWAY_LOG" env OMLX_BASE_URL="$OMLX_BASE_URL" GSD_RUNTIME_GATEWAY_BEARER="${GSD_RUNTIME_GATEWAY_BEARER:-}" "$GATEWAY_VENV/bin/uvicorn" app:app --app-dir "$ROOT_DIR/services/runtime-gateway" --host 127.0.0.1 --port "$GATEWAY_PORT"
if ! wait_for_http "runtime-gateway" "$GATEWAY_BASE_URL/healthz" 60 1; then
  show_log_tail "$GATEWAY_LOG"
  exit 1
fi

echo "Starting run-api on $RUN_API_BASE_URL"
start_bg RUN_API_PID "$RUN_API_LOG" env AGENT_STACK_BASE_DIR="$ROOT_DIR" AGENT_STACK_RUN_API_PORT="$RUN_API_PORT" GSD_RUNTIME_GATEWAY_URL="$GATEWAY_BASE_URL" GSD_RUNTIME_GATEWAY_BEARER="${GSD_RUNTIME_GATEWAY_BEARER:-}" node "$RUN_API_DIST"
if ! wait_for_http "run-api" "$RUN_API_BASE_URL/healthz" 60 1; then
  show_log_tail "$RUN_API_LOG"
  exit 1
fi

echo "Stack is ready"
echo "  oMLX log: $OMLX_LOG"
echo "  runtime-gateway log: $GATEWAY_LOG"
echo "  run-api log: $RUN_API_LOG"

wait "$OMLX_PID" "$GATEWAY_PID" "$RUN_API_PID"
