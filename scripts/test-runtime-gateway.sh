#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd curl
require_cmd python3

BASE_URL="${GSD_RUNTIME_GATEWAY_URL:-http://127.0.0.1:8787}"
TOKEN="${GSD_RUNTIME_GATEWAY_BEARER:-}"
MODEL="${AGENT_STACK_MODEL:-local-qwen-coder}"
BAD_MODEL="${AGENT_STACK_BAD_MODEL:-blocked-model}"
AUTH=()
if [[ -n "$TOKEN" ]]; then
  AUTH=(-H "authorization: Bearer $TOKEN")
fi

req() {
  curl -fsS "${AUTH[@]}" "$@"
}

post_json() {
  curl -fsS -X POST "${AUTH[@]}" -H 'content-type: application/json' "$@"
}

chat_payload() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

model = sys.argv[1]
prompt = sys.argv[2]
print(json.dumps({
    'model': model,
    'messages': [{'role': 'user', 'content': prompt}],
    'max_tokens': 16,
    'stream': False,
}))
PY
}

echo '[1/6] healthz'
req "$BASE_URL/healthz" | head -c 400 && echo

echo '[2/6] capabilities'
req "$BASE_URL/v1/capabilities" | head -c 400 && echo

echo '[3/6] runtime status'
req "$BASE_URL/v1/runtime/status" | head -c 400 && echo

echo '[4/6] models'
req "$BASE_URL/v1/models" | head -c 400 && echo

echo '[5/6] denied model should fail'
denied_body="$(mktemp)"
denied_status=$(curl -sS -o "$denied_body" -w '%{http_code}' -X POST "${AUTH[@]}" -H 'content-type: application/json' "$BASE_URL/v1/chat/completions" --data "$(chat_payload "$BAD_MODEL" "hi")")
if [[ "$denied_status" == "200" ]]; then
  echo 'expected denied model request to fail'
  exit 1
fi
head -c 400 "$denied_body" && echo

echo '[6/6] allowed model'
post_json "$BASE_URL/v1/chat/completions" --data "$(chat_payload "$MODEL" "Respond with ok.")" | head -c 400 && echo
