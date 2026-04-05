#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd curl
require_cmd python3

BASE_URL="${OMLX_BASE_URL:-http://127.0.0.1:8000}"
MODEL="${OMLX_TEST_MODEL:-local-qwen-coder}"
PROMPT="${OMLX_TEST_PROMPT:-Respond with the word ok.}"

json_payload() {
  python3 - "$MODEL" "$PROMPT" "$1" <<'PY'
import json
import sys

model = sys.argv[1]
prompt = sys.argv[2]
stream = sys.argv[3].lower() == 'true'
print(json.dumps({
    'model': model,
    'messages': [{'role': 'user', 'content': prompt}],
    'max_tokens': 32,
    'stream': stream,
}))
PY
}

echo "[1/4] GET /v1/models"
curl -fsS "$BASE_URL/v1/models" >/tmp/omlx-models.json
head -c 400 /tmp/omlx-models.json && echo

echo "[2/4] POST /v1/chat/completions"
curl -fsS -X POST "$BASE_URL/v1/chat/completions"   -H 'content-type: application/json'   --data "$(json_payload false)"   >/tmp/omlx-chat.json
head -c 400 /tmp/omlx-chat.json && echo

echo "[3/4] streaming smoke test"
curl -fsS -N -X POST "$BASE_URL/v1/chat/completions"   -H 'content-type: application/json'   --data "$(json_payload true)"   >/tmp/omlx-stream.txt
head -c 400 /tmp/omlx-stream.txt && echo

echo "[4/4] runtime status"
if curl -fsS "$BASE_URL/admin/api/status" >/tmp/omlx-status.json 2>/dev/null; then
  head -c 400 /tmp/omlx-status.json && echo
else
  echo "admin status endpoint unavailable; skipped"
fi

echo "oMLX integration smoke test completed"
