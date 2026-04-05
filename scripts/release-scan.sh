#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

failures=0

scan_pattern() {
  local label="$1"
  local pattern="$2"
  local results
  results=$(find . -type f -name "$pattern"     ! -path './vendor/*'     ! -path './references/*'     ! -path './.git/*' || true)
  if [[ -n "$results" ]]; then
    echo "[FAIL] $label"
    echo "$results"
    failures=$((failures+1))
  fi
}

scan_grep() {
  local label="$1"
  local regex="$2"
  local results
  results=$(grep -RInE "$regex" .     --exclude-dir=.git     --exclude-dir=vendor     --exclude-dir=references     --exclude='*.md' --exclude='release-scan.sh' --exclude='security-validator.ts' || true)
  if [[ -n "$results" ]]; then
    echo "[FAIL] $label"
    echo "$results" | head -n 20
    failures=$((failures+1))
  fi
}

scan_pattern 'sourcemaps present' '*.map'
scan_pattern 'dotenv files present' '.env'
scan_pattern 'private keys present' '*.key'
scan_pattern 'certificate bundles present' '*.pem'
scan_pattern 'pkcs12 bundles present' '*.p12'
scan_pattern 'unexpected archives present' '*.zip'
scan_pattern 'debug logs present' '*.log'
scan_pattern 'trace dumps present' '*.trace'
scan_grep 'probable credential string present' '(OPENAI_API_KEY|ANTHROPIC_API_KEY|aws_secret_access_key|BEGIN PRIVATE KEY)'

if [[ $failures -gt 0 ]]; then
  echo "release scan failed: $failures issue class(es) detected"
  exit 1
fi

echo 'release scan passed'
