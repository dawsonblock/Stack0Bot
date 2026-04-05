import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile, writeFile } from 'node:fs/promises';
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
    assert.equal(record.validation?.executedValidatorCount, 2);
    assert.equal(record.approval, undefined);

    const worktreeDir = controller.worktreeFor(record.runId);
    await assert.rejects(() => access(join(worktreeDir, 'greeting.js')));
    await assert.rejects(() => controller.applyApproved(record.runId), /run run-executable is not approved/);

    const events = await controller.getEvents(record.runId);
    assert.equal(events.filter((event) => event.type === 'validator_executed').length, 2);

    const artifacts = await controller.getArtifacts(record.runId);
    assert(artifacts.some((artifact) => artifact.kind === 'patch'));
    assert(artifacts.filter((artifact) => artifact.kind === 'validator-report').length >= 4);

    await controller.approve(record.runId, { actor: 'operator', reason: 'looks good' });
    const applied = await controller.applyApproved(record.runId);
    assert.equal(applied.state, 'applied');
    const beforeComplete = await readFile(join(worktreeDir, 'greeting.js'), 'utf8');

    const completed = await controller.completeApplied(record.runId, 'done');
    assert.equal(completed.state, 'completed');
    const afterComplete = await readFile(join(worktreeDir, 'greeting.js'), 'utf8');
    assert.equal(afterComplete, beforeComplete);
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
  });
});