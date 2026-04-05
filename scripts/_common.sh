#!/usr/bin/env bash

if [[ -z "${ROOT_DIR:-}" ]]; then
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

require_cmd() {
  local command_name="$1"
  local message="${2:-Install '$command_name' and retry.}"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    echo "$message" >&2
    exit 1
  fi
}

require_file() {
  local path="$1"
  local message="${2:-Required file is missing: $path}"
  if [[ ! -f "$path" ]]; then
    echo "$message" >&2
    exit 1
  fi
}

require_dir() {
  local path="$1"
  local message="${2:-Required directory is missing: $path}"
  if [[ ! -d "$path" ]]; then
    echo "$message" >&2
    exit 1
  fi
}

print_json() {
  python3 -m json.tool
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local attempts="${3:-30}"
  local delay_seconds="${4:-1}"
  shift 4
  local -a curl_args=()
  if [[ $# -gt 0 ]]; then
    curl_args=("$@")
  fi

  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if [[ ${#curl_args[@]} -gt 0 ]]; then
      if curl -fsS "${curl_args[@]}" "$url" >/dev/null 2>&1; then
        return 0
      fi
    elif curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_seconds"
  done

  echo "$label did not become ready at $url after $attempts attempts" >&2
  return 1
}

show_log_tail() {
  local path="$1"
  local lines="${2:-80}"
  if [[ -f "$path" ]]; then
    echo "--- tail: $path ---" >&2
    tail -n "$lines" "$path" >&2
  fi
}

json_field() {
  local expression="$1"
  python3 -c '
import json
import sys

parts = sys.argv[1].split(".")
data = json.load(sys.stdin)
value = data
for part in parts:
  if part.isdigit():
    value = value[int(part)]
  else:
    value = value[part]
if isinstance(value, (dict, list)):
  print(json.dumps(value))
else:
  print(value)
' "$expression"
}

make_json() {
  python3 - "$@"
}