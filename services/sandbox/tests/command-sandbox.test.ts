import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseSandboxCommand, runInSandbox } from '../index.js';
import { withTempDir } from '../../../tests/core-test-helpers.ts';

test('parseSandboxCommand preserves quoted arguments without invoking a shell', () => {
  const parsed = parseSandboxCommand('node -e "process.stdout.write(\'ok\')"');
  assert.equal(parsed.command, 'node');
  assert.deepEqual(parsed.args, ['-e', "process.stdout.write('ok')"]);
});

test('parseSandboxCommand rejects shell metacharacters', () => {
  assert.throws(() => parseSandboxCommand('node -e "console.log(1)"; echo bad'), /unsupported shell syntax/);
  assert.throws(() => parseSandboxCommand('node -e "console.log(1)" && echo bad'), /unsupported shell syntax/);
});

test('parseSandboxCommand rejects unterminated quotes', () => {
  assert.throws(() => parseSandboxCommand('node -e "console.log(1)'), /unterminated escape or quote/);
});

test('runInSandbox enforces allowlists and cwd scoping', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });

    await assert.rejects(
      () => runInSandbox({ command: 'node', args: ['-e', 'process.stdout.write("ok")'] }, '.', {
        worktreeDir,
        allowNetwork: false,
        timeoutMs: 5_000,
        allowedCommands: ['rg'],
      }),
      /command "node" not allowlisted/,
    );

    await assert.rejects(
      () => runInSandbox({ command: 'node', args: ['-e', 'process.stdout.write("ok")'] }, '..', {
        worktreeDir,
        allowNetwork: false,
        timeoutMs: 5_000,
        allowedCommands: ['node'],
      }),
      /cwd escapes worktree/,
    );
  });
});

test('runInSandbox reports degraded network support honestly when host enforcement is unavailable', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });

    const result = await runInSandbox({ command: 'node', args: ['-e', 'process.stdout.write("ok")'] }, '.', {
      worktreeDir,
      allowNetwork: false,
      timeoutMs: 5_000,
      allowedCommands: ['node'],
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdout, 'ok');
    assert.equal(result.capability.networkIsolationSupported, false);
    assert.equal(result.capability.networkIsolationEnforced, false);
    assert.equal(result.capability.networkAccessActual, 'degraded');
    assert.equal(result.capability.networkIsolated, false);
  });
});

test('runInSandbox enforces timeouts for long-running commands', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });

    const result = await runInSandbox({ command: 'node', args: ['-e', 'setTimeout(() => {}, 10_000)'] }, '.', {
      worktreeDir,
      allowNetwork: false,
      timeoutMs: 50,
      allowedCommands: ['node'],
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
  });
});