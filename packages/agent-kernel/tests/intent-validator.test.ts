import assert from 'node:assert/strict';
import test from 'node:test';

import { validateIntent } from '../src/intents/intent-validator.js';

test('validateIntent normalizes base string fields and relative paths deterministically', () => {
  const intent = validateIntent({
    type: 'read_file',
    runId: ' run-1 ',
    intentId: ' intent-1 ',
    requestedBy: ' operator ',
    createdAt: ' 2026-01-01T00:00:00.000Z ',
    path: './docs//note.txt',
  });

  assert.equal(intent.type, 'read_file');
  assert.equal(intent.runId, 'run-1');
  assert.equal(intent.intentId, 'intent-1');
  assert.equal(intent.requestedBy, 'operator');
  assert.equal(intent.createdAt, '2026-01-01T00:00:00.000Z');
  if (intent.type !== 'read_file') {
    throw new Error('expected read_file intent');
  }
  assert.equal(intent.path, 'docs/note.txt');
});

test('distinct valid inputs stay distinct after normalization and bounds are clamped', () => {
  const alpha = validateIntent({
    type: 'search_code',
    runId: 'run-alpha',
    intentId: 'alpha',
    requestedBy: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z',
    query: ' alpha ',
    cwd: './src//',
    limit: 999,
  });
  const beta = validateIntent({
    type: 'search_code',
    runId: 'run-beta',
    intentId: 'beta',
    requestedBy: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z',
    query: ' beta ',
    cwd: './src//',
    limit: 0,
  });

  assert.equal(alpha.type, 'search_code');
  assert.equal(beta.type, 'search_code');
  if (alpha.type !== 'search_code' || beta.type !== 'search_code') {
    throw new Error('expected search_code intents');
  }

  assert.equal(alpha.query, 'alpha');
  assert.equal(beta.query, 'beta');
  assert.notEqual(alpha.query, beta.query);
  assert.equal(alpha.cwd, 'src');
  assert.equal(beta.cwd, 'src');
  assert.equal(alpha.limit, 200);
  assert.equal(beta.limit, 1);
});

test('whitespace-only required fields are rejected safely', () => {
  assert.throws(
    () => validateIntent({
      type: 'ask_user',
      runId: 'run-ask',
      intentId: 'ask',
      requestedBy: 'operator',
      createdAt: '2026-01-01T00:00:00.000Z',
      prompt: '   ',
    }),
    /ask_user.prompt is required/,
  );
});