import assert from 'node:assert/strict';
import test from 'node:test';

import { selectNextAction } from '../src/runtime/next-action.js';

test('selectNextAction maps supported intent and state combinations deterministically', () => {
  assert.equal(selectNextAction({ currentState: 'executing', intentType: 'edit_files' }), 'review_patch');
  assert.equal(selectNextAction({ currentState: 'executing', intentType: 'read_file' }), 'complete_run');
  assert.equal(selectNextAction({ currentState: 'validated', intentType: 'edit_files' }), 'await_operator_approval');
  assert.equal(selectNextAction({ currentState: 'approved', intentType: 'edit_files' }), 'apply_patch');
  assert.equal(selectNextAction({ currentState: 'applied', intentType: 'edit_files' }), 'complete_run');
  assert.equal(selectNextAction({ currentState: 'completed', intentType: 'read_file' }), 'none');
});