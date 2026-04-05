import assert from 'node:assert/strict';
import { RunStateMachine } from '../src/runtime/state-machine.js';

const happy = new RunStateMachine('created');
happy.transition('planning');
happy.transition('awaiting_action');
happy.transition('executing');
happy.transition('proposed');
happy.transition('awaiting_approval');
happy.transition('validated');
happy.transition('approved');
happy.transition('applied');
happy.transition('completed');
assert.equal(happy.current, 'completed');

const rejected = new RunStateMachine('created');
rejected.transition('planning');
rejected.transition('awaiting_action');
rejected.transition('executing');
rejected.transition('proposed');
rejected.transition('awaiting_approval');
rejected.transition('validated');
rejected.transition('rejected');
rejected.transition('failed');
assert.equal(rejected.current, 'failed');

const invalid = new RunStateMachine('validated');
assert.throws(() => invalid.transition('applied'));
assert.throws(() => invalid.transition('completed'));

const terminal = new RunStateMachine('completed');
assert.throws(() => terminal.transition('failed'));
