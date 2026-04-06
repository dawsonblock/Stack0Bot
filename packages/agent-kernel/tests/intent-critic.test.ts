import assert from 'node:assert/strict';
import test from 'node:test';

import { critiqueIntentCandidate } from '../src/intents/intent-critic.js';

test('critiqueIntentCandidate accepts a valid read-only intent candidate', () => {
  assert.deepEqual(critiqueIntentCandidate({
    type: 'read_file',
    path: 'notes/today.md',
  }), {
    ok: true,
    issues: [],
  });
});

test('critiqueIntentCandidate reports missing required fields', () => {
  const critique = critiqueIntentCandidate({
    type: 'read_file',
  });

  assert.equal(critique.ok, false);
  assert.deepEqual(critique.issues, [{
    code: 'missing_required_field',
    field: 'path',
    message: 'read_file.path is required',
  }]);
});

test('critiqueIntentCandidate rejects unknown intent types', () => {
  const critique = critiqueIntentCandidate({
    type: 'launch_rocket',
  });

  assert.equal(critique.ok, false);
  assert.deepEqual(critique.issues, [{
    code: 'unknown_intent_type',
    field: 'type',
    message: 'unknown intent type: launch_rocket',
  }]);
});

test('critiqueIntentCandidate flags approval-required mutating intents without approval context', () => {
  const critique = critiqueIntentCandidate({
    type: 'edit_files',
    reason: 'update doc',
    declaredWriteSet: ['README.md'],
    edits: [{ path: 'README.md', content: '# updated' }],
    policy: { approvalRequired: true },
  });

  assert.equal(critique.ok, false);
  assert.deepEqual(critique.issues, [{
    code: 'approval_context_required',
    field: 'approvalContext',
    message: 'edit_files requires approval context before execution',
  }]);
});