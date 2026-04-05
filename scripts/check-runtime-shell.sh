#!/usr/bin/env bash
set -euo pipefail

GATEWAY="${GSD_RUNTIME_GATEWAY_URL:-http://127.0.0.1:8787}"

echo "Checking runtime shell boundary against $GATEWAY"
curl -fsS "$GATEWAY/healthz" >/tmp/agent-stack-health.json
curl -fsS "$GATEWAY/v1/capabilities" >/tmp/agent-stack-capabilities.json
curl -fsS "$GATEWAY/v1/runtime/status" >/tmp/agent-stack-runtime-status.json

for file in /tmp/agent-stack-health.json /tmp/agent-stack-capabilities.json /tmp/agent-stack-runtime-status.json; do
  echo "--- $file ---"
  cat "$file" | head -c 600 && echo
  echo
  done
