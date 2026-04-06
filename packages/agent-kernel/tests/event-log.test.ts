import assert from 'node:assert/strict';
import test from 'node:test';

import { EventLog } from '../src/events/event-log.js';
import { withTempDir } from '../../../tests/core-test-helpers.ts';

test('append stamps events with parseable nondecreasing UTC timestamps', async () => {
  await withTempDir(async (baseDir) => {
    const eventLog = new EventLog(baseDir);

    const first = await eventLog.append('run-timestamps', {
      type: 'run_created',
      intentType: 'read_file',
      intentId: 'intent-1',
    });
    const second = await eventLog.append('run-timestamps', {
      type: 'intent_validated',
      intentType: 'read_file',
      intentId: 'intent-1',
    });

    assert.equal(typeof first.timestamp, 'string');
    assert.equal(typeof second.timestamp, 'string');
    assert.match(first.timestamp, /Z$/);
    assert.match(second.timestamp, /Z$/);

    const firstParsed = Date.parse(first.timestamp);
    const secondParsed = Date.parse(second.timestamp);

    assert.equal(Number.isNaN(firstParsed), false);
    assert.equal(Number.isNaN(secondParsed), false);
    assert.ok(firstParsed <= secondParsed);

    const persisted = await eventLog.readAll('run-timestamps');
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0]?.timestamp, first.timestamp);
    assert.equal(persisted[1]?.timestamp, second.timestamp);
  });
});