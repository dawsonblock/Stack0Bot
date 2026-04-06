import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIntentPayloadSummary, getIntentMetadata } from '../src/intents/intent-metadata.js';

test('intent metadata exposes runtime support and required fields', () => {
  assert.deepEqual(getIntentMetadata('read_file'), {
    supportedRuntime: true,
    mutating: false,
    requiredFields: ['path'],
    contractStatus: 'supported',
  });
  assert.deepEqual(getIntentMetadata('edit_files'), {
    supportedRuntime: true,
    mutating: true,
    requiredFields: ['reason', 'declaredWriteSet', 'edits'],
    contractStatus: 'supported',
  });
  assert.equal(getIntentMetadata('run_command').supportedRuntime, false);
  assert.equal(getIntentMetadata('run_command').contractStatus, 'reserved_unsupported');
});

test('buildIntentPayloadSummary shapes read-only and mutating intents deterministically', () => {
  assert.deepEqual(buildIntentPayloadSummary({
    type: 'read_file',
    runId: 'run-read',
    intentId: 'read-1',
    requestedBy: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z',
    path: 'notes/today.md',
  }), {
    path: 'notes/today.md',
  });

  assert.deepEqual(buildIntentPayloadSummary({
    type: 'edit_files',
    runId: 'run-edit',
    intentId: 'edit-1',
    requestedBy: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z',
    reason: 'update note',
    cwd: '.',
    declaredWriteSet: ['notes/today.md'],
    edits: [{ path: 'notes/today.md', content: 'updated' }],
  }), {
    reason: 'update note',
    declaredWriteSet: ['notes/today.md'],
    editCount: 1,
    cwd: '.',
    validationOverride: false,
  });
});

test('unsupported runtime intents remain identifiable through structured metadata', () => {
  assert.deepEqual(buildIntentPayloadSummary({
    type: 'run_command',
    runId: 'run-command',
    intentId: 'command-1',
    requestedBy: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z',
    command: 'echo hello',
    cwd: '.',
    allowNetwork: false,
    timeoutMs: 1000,
  }), {
    command: 'echo hello',
    cwd: '.',
    allowNetwork: false,
    timeoutMs: 1000,
  });
  assert.equal(getIntentMetadata('run_command').supportedRuntime, false);
});