#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-.}"

echo "Scanning $TARGET for risky packaging artifacts"
find "$TARGET" \
  \( -name '*.map' -o -name '*.zip' -o -name '*.tgz' -o -name '*.tar' -o -name '.env' -o -name '*.pem' -o -name '*.p12' \) \
  -print

echo
if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
  echo "npm pack dry run:"
  npm pack --dry-run || true
else
  echo "npm not available or package.json missing; skipping npm dry run"
fi
