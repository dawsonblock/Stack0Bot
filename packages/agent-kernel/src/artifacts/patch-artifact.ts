import { createHash } from 'node:crypto';
import type { EditFileSpec } from '../intents/intent.types.js';

export type PatchArtifact = {
  runId: string;
  patchId: string;
  proposedBy: string;
  reason: string;
  changedFiles: string[];
  declaredWriteSet: string[];
  unifiedDiff: string;
  beforeHashes: Record<string, string | null>;
  afterHashes: Record<string, string>;
  snapshots: EditFileSpec[];
  createdAt: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildPatchArtifact(input: {
  runId: string;
  proposedBy: string;
  reason: string;
  declaredWriteSet: string[];
  edits: EditFileSpec[];
  beforeContent: Record<string, string | null>;
  unifiedDiff: string;
}): PatchArtifact {
  const changedFiles = input.edits.map((edit) => edit.path);
  const beforeHashes: Record<string, string | null> = {};
  const afterHashes: Record<string, string> = {};
  for (const edit of input.edits) {
    const before = input.beforeContent[edit.path] ?? null;
    beforeHashes[edit.path] = before === null ? null : sha256(before);
    afterHashes[edit.path] = sha256(edit.content);
  }
  const patchId = sha256(JSON.stringify({
    runId: input.runId,
    changedFiles,
    unifiedDiff: input.unifiedDiff,
    afterHashes,
  }));
  return {
    runId: input.runId,
    patchId,
    proposedBy: input.proposedBy,
    reason: input.reason,
    changedFiles,
    declaredWriteSet: input.declaredWriteSet,
    unifiedDiff: input.unifiedDiff,
    beforeHashes,
    afterHashes,
    snapshots: input.edits,
    createdAt: new Date().toISOString(),
  };
}

export function validatePatchArtifact(artifact: PatchArtifact): void {
  if (!artifact.reason.trim()) throw new Error('patch artifact missing reason');
  if (!artifact.changedFiles.length) throw new Error('patch artifact has no changed files');
  if (!artifact.unifiedDiff.trim()) throw new Error('patch artifact missing unified diff');
}
