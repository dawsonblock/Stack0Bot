import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ArtifactStore } from '../src/artifacts/artifact-store.js';
import { EventLog } from '../src/events/event-log.js';
import { ExecutionAuthority } from '../src/runtime/execution-authority.js';
import { withTempDir } from '../../../tests/core-test-helpers.ts';

function makeAuthority(baseDir: string, runId: string) {
  return new ExecutionAuthority(
    {
      runId,
      actor: 'tester',
      worktreeDir: join(baseDir, 'workspace'),
    },
    new ArtifactStore(baseDir),
    new EventLog(baseDir),
    {
      baseUrl: 'http://127.0.0.1:9',
      maxTokensDefault: 256,
    },
  );
}

test('execution authority rejects unsupported runtime intents', async () => {
  await withTempDir(async (baseDir) => {
    const authority = makeAuthority(baseDir, 'run-command');
    const result = await authority.execute({
      type: 'run_command',
      runId: 'run-command',
      intentId: 'command-1',
      requestedBy: 'operator',
      createdAt: '2026-01-01T00:00:00.000Z',
      command: 'echo hello',
      cwd: '.',
      allowNetwork: false,
      timeoutMs: 1000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorDetail?.code, 'policy_violation');
  });
});

test('execution authority rejects missing required fields at the boundary', async () => {
  await withTempDir(async (baseDir) => {
    const authority = makeAuthority(baseDir, 'run-missing-field');
    const result = await authority.execute({
      type: 'read_file',
      runId: 'run-missing-field',
      intentId: 'read-1',
      requestedBy: 'operator',
      createdAt: '2026-01-01T00:00:00.000Z',
      path: '',
    } as any);

    assert.equal(result.ok, false);
    assert.equal(result.errorDetail?.code, 'validation_failed');
    assert.deepEqual(result.data, {
      issues: [{ code: 'missing_required_field', field: 'path', message: 'read_file.path is required' }],
    });
  });
});

test('execution authority returns uniform empty receipts for successful non-artifact actions', async () => {
  await withTempDir(async (baseDir) => {
    const authority = makeAuthority(baseDir, 'run-ask-user');
    const result = await authority.execute({
      type: 'ask_user',
      runId: 'run-ask-user',
      intentId: 'ask-1',
      requestedBy: 'operator',
      createdAt: '2026-01-01T00:00:00.000Z',
      prompt: 'confirm?',
      choices: ['yes', 'no'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.artifactIds, []);
    assert.deepEqual(result.artifactPaths, []);
  });
});

test('execution authority succeeds for allowed read-only execution', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(join(worktreeDir, 'note.txt'), 'hello\n', 'utf8');

    const authority = makeAuthority(baseDir, 'run-read-file');
    const result = await authority.execute({
      type: 'read_file',
      runId: 'run-read-file',
      intentId: 'read-1',
      requestedBy: 'operator',
      createdAt: '2026-01-01T00:00:00.000Z',
      path: 'note.txt',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.artifactIds?.length, 1);
    assert.deepEqual(result.artifactPaths?.length, 1);
  });
});