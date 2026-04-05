import assert from 'node:assert/strict';
import { canExecute } from '../mcp/mcp-policy.js';

const policy = {
  defaultAction: 'deny',
  approvedServers: [
    { name: 'github', category: 'read_only', source: 'official', purpose: 'lookup', requiresReview: false, requiresReceipts: false, enabled: true },
  ],
};

assert.equal(canExecute('github', 'read_only', policy).allowed, true);
assert.equal(canExecute('github', 'mutating', policy).allowed, false);
assert.equal(canExecute('unknown', 'read_only', policy).allowed, false);
