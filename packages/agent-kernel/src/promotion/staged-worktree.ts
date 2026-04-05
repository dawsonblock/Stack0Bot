import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative, resolve } from 'node:path';

import type { ArtifactRecord, ArtifactStore } from '../artifacts/artifact-store.js';
import type { PatchArtifact } from '../artifacts/patch-artifact.js';

function resolveStagedPath(worktreeDir: string, relativePath: string): string {
  const candidate = resolve(join(worktreeDir, normalize(relativePath)));
  const rel = relative(resolve(worktreeDir), candidate);
  if (rel.startsWith('..')) {
    throw new Error(`path escapes staged worktree: ${relativePath}`);
  }
  return candidate;
}

export async function prepareValidationWorktree(args: {
  runId: string;
  worktreeDir: string;
  patchArtifact: ArtifactRecord;
  artifacts: ArtifactStore;
}): Promise<{ stagedWorktreeDir: string; cleanup: () => Promise<void> }> {
  const stagedWorktreeDir = await mkdtemp(join(tmpdir(), `agent-stack-validation-${args.runId}-`));
  await cp(args.worktreeDir, stagedWorktreeDir, { recursive: true, force: true, errorOnExist: false });

  const patch = JSON.parse(await args.artifacts.read(args.patchArtifact)) as PatchArtifact;
  for (const snapshot of patch.snapshots) {
    const target = resolveStagedPath(stagedWorktreeDir, snapshot.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, snapshot.content, snapshot.encoding ?? 'utf8');
  }

  return {
    stagedWorktreeDir,
    cleanup: async () => {
      await rm(stagedWorktreeDir, { recursive: true, force: true });
    },
  };
}