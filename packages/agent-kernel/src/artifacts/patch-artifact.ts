import { createHash } from 'node:crypto';
import type { EditFileSpec } from '../intents/intent.types.js';
import { utcNowIso } from '../time.js';

export type PatchDiffFormat = 'unified';

export type PatchLineChange = {
  line: number;
  content: string;
};

export type PatchLineDeltas = {
  added: PatchLineChange[];
  removed: PatchLineChange[];
};

export type PatchArtifact = {
  runId: string;
  intentId: string;
  requestedBy: string;
  patchId: string;
  proposedBy: string;
  reason: string;
  changedFiles: string[];
  declaredWriteSet: string[];
  diffFormat: PatchDiffFormat;
  unifiedDiff: string;
  lineDeltas: Record<string, PatchLineDeltas>;
  beforeHashes: Record<string, string | null>;
  afterHashes: Record<string, string>;
  snapshots: EditFileSpec[];
  createdAt: string;
};

type DiffOp = {
  type: 'context' | 'add' | 'remove';
  line: string;
  beforeLine?: number;
  afterLine?: number;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function splitContentLines(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  const lines = value.split('\n');
  if (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function buildDiffOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const lengths = Array.from({ length: beforeLines.length + 1 }, () => Array<number>(afterLines.length + 1).fill(0));

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(lengths[beforeIndex + 1][afterIndex], lengths[beforeIndex][afterIndex + 1]);
    }
  }

  const operations: DiffOp[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  let beforeLine = 1;
  let afterLine = 1;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      operations.push({ type: 'context', line: beforeLines[beforeIndex], beforeLine, afterLine });
      beforeIndex += 1;
      afterIndex += 1;
      beforeLine += 1;
      afterLine += 1;
      continue;
    }

    if (lengths[beforeIndex + 1][afterIndex] >= lengths[beforeIndex][afterIndex + 1]) {
      operations.push({ type: 'remove', line: beforeLines[beforeIndex], beforeLine });
      beforeIndex += 1;
      beforeLine += 1;
      continue;
    }

    operations.push({ type: 'add', line: afterLines[afterIndex], afterLine });
    afterIndex += 1;
    afterLine += 1;
  }

  while (beforeIndex < beforeLines.length) {
    operations.push({ type: 'remove', line: beforeLines[beforeIndex], beforeLine });
    beforeIndex += 1;
    beforeLine += 1;
  }

  while (afterIndex < afterLines.length) {
    operations.push({ type: 'add', line: afterLines[afterIndex], afterLine });
    afterIndex += 1;
    afterLine += 1;
  }

  return operations;
}

function formatRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

function buildFileDiff(path: string, beforeContent: string | null, afterContent: string): { unifiedDiff: string; lineDeltas: PatchLineDeltas } {
  const beforeLines = splitContentLines(beforeContent);
  const afterLines = splitContentLines(afterContent);
  const operations = buildDiffOps(beforeLines, afterLines);
  const lineDeltas: PatchLineDeltas = {
    added: operations
      .filter((operation) => operation.type === 'add')
      .map((operation) => ({ line: operation.afterLine ?? 0, content: operation.line })),
    removed: operations
      .filter((operation) => operation.type === 'remove')
      .map((operation) => ({ line: operation.beforeLine ?? 0, content: operation.line })),
  };

  const diffLines = [
    `--- ${beforeContent === null ? '/dev/null' : `a/${path}`}`,
    `+++ b/${path}`,
  ];
  const firstChangeIndex = operations.findIndex((operation) => operation.type !== 'context');

  if (firstChangeIndex === -1) {
    diffLines.push(`@@ -${formatRange(beforeLines.length > 0 ? 1 : 0, beforeLines.length)} +${formatRange(afterLines.length > 0 ? 1 : 0, afterLines.length)} @@`);
    for (const line of afterLines) {
      diffLines.push(` ${line}`);
    }
    return {
      unifiedDiff: diffLines.join('\n'),
      lineDeltas,
    };
  }

  const contextLines = 3;
  let index = 0;
  while (index < operations.length) {
    while (index < operations.length && operations[index].type === 'context') {
      index += 1;
    }
    if (index >= operations.length) {
      break;
    }

    const hunkStart = Math.max(0, index - contextLines);
    let lastChangeIndex = index;
    let cursor = index;
    while (cursor < operations.length) {
      if (operations[cursor].type !== 'context') {
        lastChangeIndex = cursor;
      }
      if (cursor - lastChangeIndex > contextLines) {
        break;
      }
      cursor += 1;
    }

    const hunkEnd = Math.min(operations.length, lastChangeIndex + contextLines + 1);
    const hunk = operations.slice(hunkStart, hunkEnd);
    const beforeSlice = hunk.filter((operation) => operation.type !== 'add');
    const afterSlice = hunk.filter((operation) => operation.type !== 'remove');
    const beforeStart = beforeSlice[0]?.beforeLine ?? 0;
    const afterStart = afterSlice[0]?.afterLine ?? 0;

    diffLines.push(`@@ -${formatRange(beforeStart, beforeSlice.length)} +${formatRange(afterStart, afterSlice.length)} @@`);
    for (const operation of hunk) {
      const prefix = operation.type === 'context' ? ' ' : operation.type === 'remove' ? '-' : '+';
      diffLines.push(`${prefix}${operation.line}`);
    }

    index = hunkEnd;
  }

  return {
    unifiedDiff: diffLines.join('\n'),
    lineDeltas,
  };
}

function buildUnifiedDiffAndLineDeltas(edits: EditFileSpec[], beforeContent: Record<string, string | null>): {
  unifiedDiff: string;
  lineDeltas: Record<string, PatchLineDeltas>;
} {
  const lineDeltas: Record<string, PatchLineDeltas> = {};
  const fileDiffs = edits.map((edit) => {
    const fileDiff = buildFileDiff(edit.path, beforeContent[edit.path] ?? null, edit.content);
    lineDeltas[edit.path] = fileDiff.lineDeltas;
    return fileDiff.unifiedDiff;
  });

  return {
    unifiedDiff: fileDiffs.join('\n'),
    lineDeltas,
  };
}

export function buildPatchArtifact(input: {
  runId: string;
  intentId: string;
  requestedBy: string;
  proposedBy: string;
  reason: string;
  declaredWriteSet: string[];
  edits: EditFileSpec[];
  beforeContent: Record<string, string | null>;
}): PatchArtifact {
  const { unifiedDiff, lineDeltas } = buildUnifiedDiffAndLineDeltas(input.edits, input.beforeContent);
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
    diffFormat: 'unified',
    unifiedDiff,
    afterHashes,
  }));
  return {
    runId: input.runId,
    intentId: input.intentId,
    requestedBy: input.requestedBy,
    patchId,
    proposedBy: input.proposedBy,
    reason: input.reason,
    changedFiles,
    declaredWriteSet: input.declaredWriteSet,
    diffFormat: 'unified',
    unifiedDiff,
    lineDeltas,
    beforeHashes,
    afterHashes,
    snapshots: input.edits,
    createdAt: utcNowIso(),
  };
}

export function validatePatchArtifact(artifact: PatchArtifact): void {
  if (!artifact.intentId.trim()) throw new Error('patch artifact missing intent id');
  if (!artifact.requestedBy.trim()) throw new Error('patch artifact missing requestedBy');
  if (!artifact.reason.trim()) throw new Error('patch artifact missing reason');
  if (!artifact.changedFiles.length) throw new Error('patch artifact has no changed files');
  if (artifact.diffFormat !== 'unified') throw new Error(`patch artifact has unsupported diff format: ${artifact.diffFormat}`);
  if (!artifact.unifiedDiff.trim()) throw new Error('patch artifact missing unified diff');
  for (const file of artifact.changedFiles) {
    if (!artifact.lineDeltas[file]) throw new Error(`patch artifact missing line deltas for ${file}`);
  }
}
