#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/_common.sh"

require_cmd node
require_cmd python3
require_cmd curl

RUN_API_URL="${AGENT_STACK_RUN_API_URL:-http://127.0.0.1:8788}"
MODEL="${AGENT_STACK_MODEL:-local-qwen-coder}"
ACTOR="${AGENT_STACK_ACTOR:-operator}"

run_cli() {
	AGENT_STACK_RUN_API_URL="$RUN_API_URL" AGENT_STACK_MODEL="$MODEL" AGENT_STACK_ACTOR="$ACTOR" node "$ROOT_DIR/apps/shell/bin/agent-stack-run.mjs" "$@"
}

echo '[1/9] checking oMLX, runtime-gateway, and run-api readiness'
"$ROOT_DIR/scripts/check-stack.sh" >/dev/null

echo '[2/9] creating a read-only model run through the shell CLI'
readonly_response="$(run_cli prompt 'Respond with the exact string smoke-ok.')"
readonly_run_id="$(printf '%s' "$readonly_response" | json_field 'run.runId')"
readonly_snapshot="$(run_cli get "$readonly_run_id")"
readonly_state="$(printf '%s' "$readonly_snapshot" | json_field 'run.state')"
if [[ "$readonly_state" != 'completed' ]]; then
	echo "Expected read-only run to complete, got $readonly_state" >&2
	exit 1
fi
readonly_events="$(run_cli events "$readonly_run_id")"
readonly_event_types="$(printf '%s' "$readonly_events" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
print(",".join(event["type"] for event in payload["events"]))
')"
if [[ "$readonly_event_types" != *model_called* ]]; then
	echo 'Read-only run did not record a model_called event' >&2
	exit 1
fi

echo '[3/9] creating a mutating run with a patch artifact and real validator commands'
intent_file="$(mktemp)"
python3 - "$intent_file" <<'PY'
import json
import sys

intent = {
		'type': 'edit_files',
		'requestedBy': 'operator',
		'reason': 'Create a bounded smoke fixture with real test and lint commands',
		'declaredWriteSet': ['package.json', 'greeting.js', 'greeting.test.js'],
		'edits': [
				{
						'path': 'package.json',
						'content': json.dumps({
								'name': 'smoke-fixture',
								'private': True,
								'type': 'module',
								'scripts': {
										'test': 'node --test',
										'lint': 'node --check greeting.js && node --check greeting.test.js',
								},
						}, indent=2),
				},
				{
						'path': 'greeting.js',
						'content': "export function greet() {\n  return 'smoke-ok';\n}\n",
				},
				{
						'path': 'greeting.test.js',
						'content': "import assert from 'node:assert/strict';\nimport test from 'node:test';\n\nimport { greet } from './greeting.js';\n\ntest('greet returns the smoke sentinel', () => {\n  assert.equal(greet(), 'smoke-ok');\n});\n",
				},
		],
}

with open(sys.argv[1], 'w', encoding='utf-8') as handle:
		json.dump(intent, handle, indent=2)
PY

mutating_response="$(run_cli start-file "$intent_file")"
mutating_run_id="$(printf '%s' "$mutating_response" | json_field 'run.runId')"
mutating_snapshot="$(run_cli get "$mutating_run_id")"
mutating_state="$(printf '%s' "$mutating_snapshot" | json_field 'run.state')"
if [[ "$mutating_state" != 'validated' ]]; then
	echo "Expected mutating run to validate before approval, got $mutating_state" >&2
	exit 1
fi

echo '[4/9] verifying validator events and artifacts were recorded'
mutating_events="$(run_cli events "$mutating_run_id")"
validator_event_count="$(printf '%s' "$mutating_events" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
count = sum(1 for event in payload["events"] if event["type"] == "validator_executed")
print(count)
')"
if [[ "$validator_event_count" -lt 2 ]]; then
	echo "Expected at least two validator_executed events, got $validator_event_count" >&2
	exit 1
fi

mutating_artifacts="$(run_cli artifacts "$mutating_run_id")"
validator_report_count="$(printf '%s' "$mutating_artifacts" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
count = sum(1 for artifact in payload["artifacts"] if artifact["kind"] == "validator-report")
print(count)
')"
if [[ "$validator_report_count" -lt 4 ]]; then
	echo "Expected validator-report artifacts for test, lint, diff, and security checks" >&2
	exit 1
fi

echo '[5/9] recording explicit approval'
approval_response="$(run_cli approve "$mutating_run_id" 'bounded smoke approval')"
approval_state="$(printf '%s' "$approval_response" | json_field 'run.state')"
if [[ "$approval_state" != 'approved' ]]; then
	echo "Expected approved state after approval, got $approval_state" >&2
	exit 1
fi

echo '[6/9] applying the approved patch artifact'
apply_response="$(run_cli apply "$mutating_run_id")"
apply_state="$(printf '%s' "$apply_response" | json_field 'run.state')"
if [[ "$apply_state" != 'applied' ]]; then
	echo "Expected applied state after patch application, got $apply_state" >&2
	exit 1
fi

echo '[7/9] completing the run without further mutation'
complete_response="$(run_cli complete "$mutating_run_id" 'smoke lifecycle complete')"
complete_state="$(printf '%s' "$complete_response" | json_field 'run.state')"
if [[ "$complete_state" != 'completed' ]]; then
	echo "Expected completed state after finalization, got $complete_state" >&2
	exit 1
fi

echo '[8/9] verifying final artifacts, events, and worktree files'
final_snapshot="$(run_cli get "$mutating_run_id")"
worktree_dir="$(printf '%s' "$final_snapshot" | json_field 'worktreeDir')"
require_file "$worktree_dir/package.json" "Applied worktree is missing package.json"
require_file "$worktree_dir/greeting.js" "Applied worktree is missing greeting.js"
require_file "$worktree_dir/greeting.test.js" "Applied worktree is missing greeting.test.js"

summary_artifact_count="$(printf '%s' "$(run_cli artifacts "$mutating_run_id")" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
count = sum(1 for artifact in payload["artifacts"] if artifact["kind"] == "summary")
print(count)
')"
if [[ "$summary_artifact_count" -lt 1 ]]; then
	echo 'Expected a summary artifact after completion' >&2
	exit 1
fi

echo '[9/9] smoke path completed successfully'
echo "Read-only run: $readonly_run_id"
echo "Mutating run: $mutating_run_id"
echo "Applied worktree: $worktree_dir"