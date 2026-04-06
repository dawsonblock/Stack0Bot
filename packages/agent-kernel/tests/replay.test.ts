import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentEvent } from '../src/events/event-types.js';
import { replayRun } from '../src/events/replay.js';
import { RuntimeController } from '../src/runtime/runtime-controller.js';
import { withTempDir } from '../../../tests/core-test-helpers.ts';

function buildExecutableEditIntent(runId: string) {
  return {
    type: 'edit_files' as const,
    runId,
    intentId: `${runId}-intent`,
    requestedBy: 'operator',
    createdAt: new Date().toISOString(),
    reason: 'Create a bounded test fixture with executable validation commands',
    declaredWriteSet: ['package.json', 'greeting.js', 'greeting.test.js'],
    edits: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'fixture',
          private: true,
          type: 'module',
          scripts: {
            test: 'node --test',
            lint: 'node --check greeting.js && node --check greeting.test.js',
          },
        }, null, 2),
      },
      {
        path: 'greeting.js',
        content: "export function greet() {\n  return 'ok';\n}\n",
      },
      {
        path: 'greeting.test.js',
        content: [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          '',
          "import { greet } from './greeting.js';",
          '',
          "test('greet returns the sentinel', () => {",
          "  assert.equal(greet(), 'ok');",
          '});',
          '',
        ].join('\n'),
      },
    ],
  };
}

function makeController(baseDir: string) {
  return new RuntimeController({
    baseDir,
    actor: 'tester',
    runtimeGateway: {
      baseUrl: 'http://127.0.0.1:9',
      maxTokensDefault: 256,
    },
  });
}

test('replayRun skips partial or null event records without crashing', () => {
  const replay = replayRun([
    null as unknown as AgentEvent,
    {
      type: 'intent_received',
      runId: 'run-replay-partial',
      timestamp: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    },
    {
      type: 'artifact_written',
      runId: 'run-replay-partial',
      timestamp: '2026-01-01T00:00:01.000Z',
      schemaVersion: 1,
      artifactId: 'artifact-1',
    },
    {
      type: 'promotion_evaluated',
      runId: 'run-replay-partial',
      timestamp: '2026-01-01T00:00:02.000Z',
      schemaVersion: 1,
      ok: true,
    },
    {
      type: 'approval_recorded',
      runId: 'run-replay-partial',
      timestamp: '2026-01-01T00:00:03.000Z',
      schemaVersion: 1,
      approved: false,
    },
    {
      type: 'run_failed',
      runId: 'run-replay-partial',
      timestamp: '2026-01-01T00:00:04.000Z',
      schemaVersion: 1,
      reason: null,
    },
    { unexpected: true } as unknown as AgentEvent,
  ]);

  assert.equal(replay.intentCount, 1);
  assert.deepEqual(replay.artifactIds, ['artifact-1']);
  assert.equal(replay.validationOk, true);
  assert.equal(replay.validationSummary, undefined);
  assert.equal(replay.approvalStatus, 'rejected');
  assert.deepEqual(replay.approvalHistory, [{ approved: false, actor: undefined, at: '2026-01-01T00:00:03.000Z', reason: undefined }]);
  assert.equal(replay.outcome, 'failed');
  assert.equal(replay.failureReason, undefined);
});

test('replayRun captures intent, approval history, and completion metadata from the event stream', () => {
  const replay = replayRun([
    {
      type: 'intent_received',
      runId: 'run-replay-complete',
      timestamp: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      intentType: 'edit_files',
    },
    {
      type: 'approval_recorded',
      runId: 'run-replay-complete',
      timestamp: '2026-01-01T00:00:01.000Z',
      schemaVersion: 1,
      approved: true,
      actor: 'operator',
      reason: 'looks good',
    },
    {
      type: 'run_completed',
      runId: 'run-replay-complete',
      timestamp: '2026-01-01T00:00:02.000Z',
      schemaVersion: 1,
      notes: 'done',
      mode: 'mutating',
    },
  ]);

  assert.equal(replay.intentType, 'edit_files');
  assert.equal(replay.approvalStatus, 'approved');
  assert.deepEqual(replay.approvalHistory, [{
    approved: true,
    actor: 'operator',
    at: '2026-01-01T00:00:01.000Z',
    reason: 'looks good',
  }]);
  assert.equal(replay.completedAt, '2026-01-01T00:00:02.000Z');
  assert.equal(replay.completionMode, 'mutating');
  assert.equal(replay.completionNotes, 'done');
});

test('getRun remains event-authoritative when the persisted run-record diverges', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildExecutableEditIntent('run-replay-authority'));

    await controller.approve(record.runId, { actor: 'operator', reason: 'looks good' });
    await controller.applyApproved(record.runId);
    await controller.completeApplied(record.runId, 'done');

    await writeFile(
      join(baseDir, 'storage', 'runs', record.runId, 'run-record.json'),
      `${JSON.stringify({
        runId: record.runId,
        state: 'created',
        nextAction: 'review_patch',
        startedAt: '2024-01-01T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf8',
    );

    const reconciled = await controller.getRun(record.runId);
    assert(reconciled);
    assert.equal(reconciled.state, 'completed');
    assert.equal(reconciled.nextAction, 'none');

    const replay = await controller.getReplay(record.runId);
    assert.equal(replay.intentType, 'edit_files');
    assert.equal(replay.approvalStatus, 'approved');
    assert.equal(replay.completionNotes, 'done');

    const summaryPath = join(baseDir, 'storage', 'runs', record.runId, 'run-record.json');
    const rawRecord = await readFile(summaryPath, 'utf8');
    assert.match(rawRecord, /"state": "created"/);
  });
});