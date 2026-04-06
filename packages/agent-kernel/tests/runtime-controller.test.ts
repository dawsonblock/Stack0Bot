import assert from 'node:assert/strict';
import test from 'node:test';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

function buildNonExecutableEditIntent(runId: string, override?: { allowMissingExecutableValidators: true; reason: string }) {
  return {
    type: 'edit_files' as const,
    runId,
    intentId: `${runId}-intent`,
    requestedBy: 'operator',
    createdAt: new Date().toISOString(),
    reason: 'Write a file without any executable validation path',
    declaredWriteSet: ['README.md'],
    validationOverride: override,
    edits: [
      {
        path: 'README.md',
        content: '# fixture\n',
      },
    ],
  };
}

function buildReadFileIntent(runId: string, path: string) {
  return {
    type: 'read_file' as const,
    runId,
    intentId: `${runId}-intent`,
    requestedBy: 'operator',
    createdAt: new Date().toISOString(),
    path,
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

test('mutating runs execute validators, remain unapplied until approval, and finalize without code mutation', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildExecutableEditIntent('run-executable'));

    assert.equal(record.state, 'validated');
    assert.equal(record.nextAction, 'await_operator_approval');
    assert.equal(record.validation?.executedValidatorCount, 2);
    assert.equal(record.approval, undefined);
    assert.ok(record.reviewBundleArtifactId);

    const worktreeDir = controller.worktreeFor(record.runId);
    await assert.rejects(() => access(join(worktreeDir, 'greeting.js')));
    await assert.rejects(() => controller.applyApproved(record.runId), /run run-executable is not approved/);

    const events = await controller.getEvents(record.runId);
    assert.equal(events.filter((event) => event.type === 'validator_executed').length, 2);
    const mutatingIntentEvent = events.find((event) => event.type === 'intent_received');
    assert.deepEqual(mutatingIntentEvent?.payload, {
      reason: 'Create a bounded test fixture with executable validation commands',
      declaredWriteSet: ['package.json', 'greeting.js', 'greeting.test.js'],
      editCount: 3,
      cwd: '.',
      validationOverride: false,
    });

    const artifacts = await controller.getArtifacts(record.runId);
    assert(artifacts.some((artifact) => artifact.kind === 'patch'));
    assert(artifacts.filter((artifact) => artifact.kind === 'validator-report').length >= 4);
    const reviewBundle = artifacts.find((artifact) => artifact.kind === 'review-bundle');
    assert(reviewBundle);
    const reviewBundlePayload = JSON.parse(await readFile(reviewBundle.path, 'utf8'));
    assert.equal(reviewBundlePayload.patch.artifactId, record.patchArtifactId);
    assert.equal(reviewBundlePayload.validation.executedValidatorCount, 2);
    assert.equal(reviewBundlePayload.override.applied, false);

    const replayBeforeApply = await controller.getReplay(record.runId);
    assert.equal(replayBeforeApply.currentState, 'validated');
    assert.equal(replayBeforeApply.outcome, 'running');
    assert.equal(replayBeforeApply.applyStatus, 'not_requested');
    assert.equal(replayBeforeApply.reviewBundleArtifactIds.length, 1);

    await controller.approve(record.runId, { actor: 'operator', reason: 'looks good' });
    const approved = await controller.getRun(record.runId);
    assert.equal(approved?.nextAction, 'apply_patch');

    const applied = await controller.applyApproved(record.runId);
    assert.equal(applied.state, 'applied');
    assert.equal(applied.nextAction, 'complete_run');
    const beforeComplete = await readFile(join(worktreeDir, 'greeting.js'), 'utf8');

    const completed = await controller.completeApplied(record.runId, 'done');
    assert.equal(completed.state, 'completed');
    assert.equal(completed.nextAction, 'none');
    const afterComplete = await readFile(join(worktreeDir, 'greeting.js'), 'utf8');
    assert.equal(afterComplete, beforeComplete);

    const replayAfterComplete = await controller.getReplay(record.runId);
    assert.equal(replayAfterComplete.currentState, 'completed');
    assert.equal(replayAfterComplete.outcome, 'completed');
    assert.equal(replayAfterComplete.applyStatus, 'applied');
    assert.equal(replayAfterComplete.reviewBundleArtifactIds.length, 1);

    const artifactsAfterComplete = await controller.getArtifacts(record.runId);
    const summaryArtifact = artifactsAfterComplete.find((artifact) => artifact.kind === 'summary');
    assert(summaryArtifact);
    const summaryPayload = JSON.parse(await readFile(summaryArtifact.path, 'utf8'));
    const finalEvents = await controller.getEvents(record.runId);
    assert.deepEqual(summaryPayload.appliedArtifactIds, artifactsAfterComplete.filter((artifact) => artifact.kind === 'patch').map((artifact) => artifact.id));
    assert.deepEqual(summaryPayload.reviewArtifactIds, artifactsAfterComplete.filter((artifact) => artifact.kind === 'review-bundle').map((artifact) => artifact.id));
    assert.equal(summaryPayload.commandCount, finalEvents.filter((event) => event.type === 'command_executed').length);
    assert.equal(summaryPayload.modelCallCount, finalEvents.filter((event) => event.type === 'model_called').length);

    const transitions = finalEvents
      .filter((event) => event.type === 'state_transition')
      .map((event) => `${event.from}->${event.to}`);
    assert.deepEqual(transitions, [
      'created->planning',
      'planning->awaiting_action',
      'awaiting_action->executing',
      'executing->proposed',
      'proposed->awaiting_approval',
      'awaiting_approval->validated',
      'validated->approved',
      'approved->applied',
      'applied->completed',
    ]);
  });
});

test('mutating runs fail closed when no executable validation path exists', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildNonExecutableEditIntent('run-fail-closed'));

    assert.equal(record.state, 'failed');
    assert.equal(record.validation?.executedValidatorCount, 0);
    assert.equal(record.validation?.overrideApplied, false);
    assert(record.validation?.results.some((result) => result.name === 'executable-validation' && result.ok === false));

    const replay = await controller.getReplay(record.runId);
    assert.equal(replay.currentState, 'failed');
    assert.equal(replay.validationOk, false);
    assert.equal(replay.outcome, 'failed');
    assert.equal(replay.applyStatus, 'not_requested');
    assert.equal(replay.reviewBundleArtifactIds.length, 1);
    assert.match(replay.failureReason ?? '', /executable validation path/i);

    const events = await controller.getEvents(record.runId);
    assert.equal(events.filter((event) => event.type === 'intent_received').length, 1);
    assert.equal(events.filter((event) => event.type === 'execution_started').length, 1);
    assert.equal(events.filter((event) => event.type === 'execution_finished').length, 1);
  });
});

test('read-only runs emit execution lifecycle events in causal order', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const runId = 'run-read-success';
    const worktreeDir = controller.worktreeFor(runId);
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(join(worktreeDir, 'note.txt'), 'hello\n', 'utf8');

    const record = await controller.startRun(buildReadFileIntent(runId, 'note.txt'));
    assert.equal(record.state, 'completed');
    assert.equal(record.nextAction, 'none');

    const events = await controller.getEvents(runId);
    const eventTypes = events.map((event) => event.type);
    const readIntentEvent = events.find((event) => event.type === 'intent_received');
    const executionStartedIndex = eventTypes.indexOf('execution_started');
    const intentReceivedIndex = eventTypes.indexOf('intent_received');
    const executionFinishedIndex = eventTypes.indexOf('execution_finished');
    const runCompletedIndex = eventTypes.indexOf('run_completed');

    assert.ok(executionStartedIndex >= 0);
    assert.ok(intentReceivedIndex > executionStartedIndex);
    assert.ok(executionFinishedIndex > intentReceivedIndex);
    assert.ok(runCompletedIndex > executionFinishedIndex);
    assert.deepEqual(readIntentEvent?.payload, { path: 'note.txt' });

    const executionFinished = events[executionFinishedIndex];
    assert.equal(executionFinished?.ok, true);
    assert.equal(executionFinished?.intentType, 'read_file');
    assert.deepEqual(executionFinished?.artifactIds, [record.result?.artifactIds?.[0]]);
  });
});

test('executor failures emit failure events, persist failed state, and stop cleanly', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const runId = 'run-read-missing';

    const record = await controller.startRun(buildReadFileIntent(runId, 'missing.txt'));
    assert.equal(record.state, 'failed');
    assert.equal(record.result?.ok, false);
    assert.equal(record.result?.errorDetail?.code, 'execution_failed');

    const events = await controller.getEvents(runId);
    const eventTypes = events.map((event) => event.type);
    const executionStartedIndex = eventTypes.indexOf('execution_started');
    const executionFinishedIndex = eventTypes.indexOf('execution_finished');
    const failedTransitionIndex = events.findIndex((event) => event.type === 'state_transition' && event.from === 'executing' && event.to === 'failed');
    const runFailedIndex = eventTypes.indexOf('run_failed');

    assert.ok(executionStartedIndex >= 0);
    assert.ok(executionFinishedIndex > executionStartedIndex);
    assert.ok(failedTransitionIndex > executionFinishedIndex);
    assert.ok(runFailedIndex > failedTransitionIndex);

    const executionFinished = events[executionFinishedIndex];
    assert.equal(executionFinished?.ok, false);
    assert.equal(executionFinished?.intentType, 'read_file');
    assert.deepEqual(executionFinished?.artifactIds, []);
    assert.equal((executionFinished?.errorDetail as { code?: string } | undefined)?.code, 'execution_failed');
    assert.match(String(executionFinished?.error ?? ''), /missing\.txt|ENOENT|no such file/i);
    assert.equal(events.filter((event) => event.type === 'intent_received').length, 1);
    assert.equal(events.filter((event) => event.type === 'execution_started').length, 1);
    assert.equal(events.filter((event) => event.type === 'execution_finished').length, 1);

    const replay = await controller.getReplay(runId);
    assert.equal(replay.currentState, 'failed');
    assert.equal(replay.outcome, 'failed');
    assert.match(replay.failureReason ?? '', /missing\.txt|ENOENT|no such file/i);
  });
});

test('mutating runs can record an explicit override for missing executable validators', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildNonExecutableEditIntent('run-override', {
      allowMissingExecutableValidators: true,
      reason: 'docs-only patch with no executable validation surface',
    }));

    assert.equal(record.state, 'validated');
    assert.equal(record.validation?.executedValidatorCount, 0);
    assert.equal(record.validation?.overrideApplied, true);
    assert.equal(record.validation?.overrideReason, 'docs-only patch with no executable validation surface');

    const events = await controller.getEvents(record.runId);
    assert(events.some((event) => event.type === 'validation_override_recorded'));
    const artifacts = await controller.getArtifacts(record.runId);
    assert(artifacts.some((artifact) => artifact.kind === 'validator-report'));
    assert(artifacts.some((artifact) => artifact.kind === 'review-bundle'));

    const replay = await controller.getReplay(record.runId);
    assert.equal(replay.currentState, 'validated');
    assert.equal(replay.validationOverrideRecorded, true);
    assert.equal(replay.reviewBundleArtifactIds.length, 1);
  });
});

test('getRun reconciles persisted state from events and artifacts when run-record diverges', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildExecutableEditIntent('run-reconcile'));

    await writeFile(
      join(baseDir, 'storage', 'runs', record.runId, 'run-record.json'),
      `${JSON.stringify({
        runId: record.runId,
        state: 'created',
        startedAt: '2024-01-01T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf8',
    );

    const reconciled = await controller.getRun(record.runId);
    assert(reconciled);
    assert.equal(reconciled.state, 'validated');
    assert.equal(reconciled.validation?.ok, true);
    assert.equal(reconciled.validation?.executedValidatorCount, 2);
    assert.ok(reconciled.patchArtifactId);
    assert.ok(reconciled.reviewBundleArtifactId);
  });
});

test('getRun and getReplay tolerate partial event records in the log', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildExecutableEditIntent('run-partial-events'));
    const eventsPath = join(baseDir, 'storage', 'runs', record.runId, 'events.jsonl');

    await appendFile(eventsPath, 'null\n{"unexpected":true}\n', 'utf8');

    const replay = await controller.getReplay(record.runId);
    assert.equal(replay.currentState, 'validated');
    assert.equal(replay.outcome, 'running');

    const reconciled = await controller.getRun(record.runId);
    assert(reconciled);
    assert.equal(reconciled.state, 'validated');
    assert.equal(reconciled.validation?.ok, true);
  });
});

test('corrupt event logs surface explicit corruption errors', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildExecutableEditIntent('run-corrupt-events'));
    const eventsPath = join(baseDir, 'storage', 'runs', record.runId, 'events.jsonl');
    const existing = await readFile(eventsPath, 'utf8');

    await writeFile(eventsPath, `${existing}{not json}\n`, 'utf8');

    await assert.rejects(
      () => controller.getEvents(record.runId),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'RunCorruptionError');
        assert.equal((error as { code?: string }).code, 'event_log_corrupt');
        assert.match(String((error as Error).message), /corrupt event log/i);
        return true;
      },
    );
  });
});

test('corrupt artifact manifests surface explicit corruption errors', async () => {
  await withTempDir(async (baseDir) => {
    const controller = makeController(baseDir);
    const record = await controller.startRun(buildExecutableEditIntent('run-corrupt-artifacts'));
    const manifestPath = join(baseDir, 'storage', 'runs', record.runId, 'artifacts', 'manifest.jsonl');
    const existing = await readFile(manifestPath, 'utf8');

    await writeFile(manifestPath, `${existing}{not json}\n`, 'utf8');

    await assert.rejects(
      () => controller.getArtifacts(record.runId),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'RunCorruptionError');
        assert.equal((error as { code?: string }).code, 'artifact_manifest_corrupt');
        assert.match(String((error as Error).message), /corrupt artifact manifest/i);
        return true;
      },
    );
  });
});

test('filesystem run locks serialize controllers for the same run id', async () => {
  await withTempDir(async (baseDir) => {
    const firstController = makeController(baseDir);
    const secondController = makeController(baseDir);
    const releaseFirst = await (firstController as any).acquireFilesystemRunLock('run-lock-shared');

    let secondAcquired = false;
    const secondPromise = ((secondController as any).acquireFilesystemRunLock('run-lock-shared') as Promise<() => Promise<void>>)
      .then((releaseSecond) => {
        secondAcquired = true;
        return releaseSecond;
      });

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(secondAcquired, false);

    await releaseFirst();
    const releaseSecond = await secondPromise;
    assert.equal(secondAcquired, true);
    await releaseSecond();
  });
});