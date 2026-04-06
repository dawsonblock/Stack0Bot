import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { applyPatchArtifact } from '../src/apply/apply-artifact.js';
import { buildPatchArtifact } from '../src/artifacts/patch-artifact.js';
import { EventLog } from '../src/events/event-log.js';
import { withTempDir } from '../../../tests/core-test-helpers.ts';

const approval = {
  approved: true as const,
  actor: 'operator',
  at: '2026-01-01T00:00:00.000Z',
  reason: 'approved for apply',
};

test('applyPatchArtifact writes the proposed snapshots and records artifact_applied', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(join(worktreeDir, 'note.txt'), 'before\n', 'utf8');

    const artifact = buildPatchArtifact({
      runId: 'run-apply',
      proposedBy: 'tester',
      reason: 'apply artifact test',
      declaredWriteSet: ['note.txt'],
      edits: [{ path: 'note.txt', content: 'after\n' }],
      beforeContent: { 'note.txt': 'before\n' },
      unifiedDiff: ['--- a/note.txt', '+++ b/note.txt', '@@', '-before', '+after'].join('\n'),
    });

    const eventLog = new EventLog(baseDir);
    await applyPatchArtifact({
      artifact,
      actor: 'tester',
      worktreeDir,
      eventLog,
      approval,
    });

    assert.equal(await readFile(join(worktreeDir, 'note.txt'), 'utf8'), 'after\n');
    const events = await eventLog.readAll('run-apply');
    assert.equal(events.at(-1)?.type, 'artifact_applied');
    assert.deepEqual(events.at(-1)?.changedFiles, ['note.txt']);
  });
});

test('applyPatchArtifact rejects drifted worktree content', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(join(worktreeDir, 'note.txt'), 'before\n', 'utf8');

    const artifact = buildPatchArtifact({
      runId: 'run-drift',
      proposedBy: 'tester',
      reason: 'drift detection test',
      declaredWriteSet: ['note.txt'],
      edits: [{ path: 'note.txt', content: 'after\n' }],
      beforeContent: { 'note.txt': 'before\n' },
      unifiedDiff: ['--- a/note.txt', '+++ b/note.txt', '@@', '-before', '+after'].join('\n'),
    });

    await writeFile(join(worktreeDir, 'note.txt'), 'changed elsewhere\n', 'utf8');
    const eventLog = new EventLog(baseDir);

    await assert.rejects(
      () => applyPatchArtifact({
        artifact,
        actor: 'tester',
        worktreeDir,
        eventLog,
        approval,
      }),
      /precondition failed for note.txt; worktree content drifted/,
    );
  });
});

test('applyPatchArtifact rejects missing approval context', async () => {
  await withTempDir(async (baseDir) => {
    const worktreeDir = join(baseDir, 'workspace');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(join(worktreeDir, 'note.txt'), 'before\n', 'utf8');

    const artifact = buildPatchArtifact({
      runId: 'run-no-approval',
      proposedBy: 'tester',
      reason: 'approval requirement test',
      declaredWriteSet: ['note.txt'],
      edits: [{ path: 'note.txt', content: 'after\n' }],
      beforeContent: { 'note.txt': 'before\n' },
      unifiedDiff: ['--- a/note.txt', '+++ b/note.txt', '@@', '-before', '+after'].join('\n'),
    });

    const eventLog = new EventLog(baseDir);
    await assert.rejects(
      () => applyPatchArtifact({
        artifact,
        actor: 'tester',
        worktreeDir,
        eventLog,
      }),
      /apply requires explicit approved context/,
    );
  });
});