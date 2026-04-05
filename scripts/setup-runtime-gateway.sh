#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd python3 "Install Python 3 and retry."
require_file "$ROOT_DIR/services/runtime-gateway/requirements.txt"

GATEWAY_VENV="$ROOT_DIR/services/runtime-gateway/.venv"

echo "Setting up runtime-gateway virtual environment in $GATEWAY_VENV"
python3 -m venv "$GATEWAY_VENV"
"$GATEWAY_VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$GATEWAY_VENV/bin/pip" install -r "$ROOT_DIR/services/runtime-gateway/requirements.txt"

if [[ ! -f "$ROOT_DIR/services/runtime-gateway/runtime-config.yaml" ]]; then
  cp "$ROOT_DIR/services/runtime-gateway/runtime-config.example.yaml" "$ROOT_DIR/services/runtime-gateway/runtime-config.yaml"
  echo "Created services/runtime-gateway/runtime-config.yaml from the example template"
fi

echo "runtime-gateway setup completed"