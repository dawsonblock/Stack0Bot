#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd python3 "Install Python 3 and retry."
require_dir "$ROOT_DIR/vendor/omlx-main" "vendor/omlx-main is missing from this checkout."

OMLX_VENV="$ROOT_DIR/vendor/omlx-main/.venv"

echo "Setting up oMLX virtual environment in $OMLX_VENV"
python3 -m venv "$OMLX_VENV"
"$OMLX_VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$OMLX_VENV/bin/pip" install -e "$ROOT_DIR/vendor/omlx-main"

echo "oMLX setup completed"
echo "If your model directory is not $HOME/models, export OMLX_MODEL_DIR before starting the stack."