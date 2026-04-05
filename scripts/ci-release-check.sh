#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

./scripts/release-scan.sh .
echo 'ci release check passed'
