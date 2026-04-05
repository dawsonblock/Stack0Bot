#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${HOME}/.gsd/agent"
TARGET_FILE="${TARGET_DIR}/models.json"
mkdir -p "$TARGET_DIR"
cp "$ROOT_DIR/configs/gsd/models.omlx.gateway.example.json" "$TARGET_FILE"
echo "Wrote $TARGET_FILE"
