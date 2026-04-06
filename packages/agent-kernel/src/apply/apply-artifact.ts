import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { EventLog } from '../events/event-log.js';
import type { PatchArtifact } from '../artifacts/patch-artifact.js';
import { RunConflictError } from '../errors/run-errors.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolveWorktreePath(worktreeDir: string, relativePath: string): string {
  const candidate = resolve(join(worktreeDir, normalize(relativePath)));
  const rel = relative(resolve(worktreeDir), candidate);
  if (rel.startsWith('..')) throw new Error(`path escapes worktree: ${relativePath}`);
  return candidate;
}

export async function applyPatchArtifact(args: {
  artifact: PatchArtifact;
  worktreeDir: string;
  actor: string;
  eventLog: EventLog;
  approval?: { approved: boolean; actor: string; at: string; reason?: string };
}): Promise<void> {
  if (!args.approval?.approved) {
    throw new RunConflictError('approval_required', 'apply requires explicit approved context');
  }

  for (const snapshot of args.artifact.snapshots) {
    const target = resolveWorktreePath(args.worktreeDir, snapshot.path);
    let currentContent: string | null = null;
    try {
      currentContent = await readFile(target, 'utf8');
    } catch {
      currentContent = null;
    }
    const currentHash = currentContent === null ? null : sha256(currentContent);
    if (currentHash !== (args.artifact.beforeHashes[snapshot.path] ?? null)) {
      throw new RunConflictError('apply_precondition_failed', `precondition failed for ${snapshot.path}; worktree content drifted`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, snapshot.content, snapshot.encoding ?? 'utf8');
  }

  await args.eventLog.append(args.artifact.runId, {
    type: 'artifact_applied',
    artifactId: args.artifact.patchId,
    actor: args.actor,
    approvedBy: args.approval.actor,
    changedFiles: args.artifact.changedFiles,
  });
}
