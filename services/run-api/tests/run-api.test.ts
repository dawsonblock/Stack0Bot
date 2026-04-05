import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunApiServer } from '../src/server.js';
import { listen, requestJson, withTempDir } from '../../../tests/core-test-helpers.ts';

function buildExecutableEditIntent(runId: string) {
  return {
    type: 'edit_files',
    runId,
    intentId: `${runId}-intent`,
    requestedBy: 'operator',
    createdAt: new Date().toISOString(),
    reason: 'Create a fixture for run-api lifecycle coverage',
    declaredWriteSet: ['package.json', 'greeting.js', 'greeting.test.js'],
    edits: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'fixture',
          private: true,
          type: 'module',
          scripts: {
            test: 'node --test',
            lint: 'node --check greeting.js && node --check greeting.test.js',
          },
        }, null, 2),
      },
      {
        path: 'greeting.js',
        content: "export function greet() {\n  return 'ok';\n}\n",
      },
      {
        path: 'greeting.test.js',
        content: [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          '',
          "import { greet } from './greeting.js';",
          '',
          "test('greet returns ok', () => {",
          "  assert.equal(greet(), 'ok');",
          '});',
          '',
        ].join('\n'),
      },
    ],
  };
}

function buildRunCommandIntent(runId: string, command: string, allowNetwork?: boolean) {
  return {
    type: 'run_command',
    runId,
    intentId: `${runId}-intent`,
    requestedBy: 'operator',
    createdAt: new Date().toISOString(),
    command,
    allowNetwork,
  };
}

test('run-api exposes the full mutating lifecycle over HTTP', async () => {
  await withTempDir(async (baseDir) => {
    const server = createRunApiServer({
      baseDir,
      actor: 'api-tester',
      runtimeGateway: {
        baseUrl: 'http://127.0.0.1:9',
        maxTokensDefault: 256,
      },
    });
    const listener = await listen(server);
    try {
      const health = await requestJson(listener.baseUrl, '/healthz');
      assert.equal(health.status, 200);

      const created = await requestJson(listener.baseUrl, '/v1/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: buildExecutableEditIntent('api-run') }),
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.run.state, 'validated');

      const listed = await requestJson(listener.baseUrl, '/v1/runs');
      assert.equal(listed.status, 200);
      assert.equal(listed.body.runs.length, 1);

      const snapshot = await requestJson(listener.baseUrl, '/v1/runs/api-run');
      assert.equal(snapshot.status, 200);
      assert.equal(snapshot.body.run.runId, 'api-run');
      assert.equal(snapshot.body.replay.currentState, 'validated');

      const events = await requestJson(listener.baseUrl, '/v1/runs/api-run/events');
      assert.equal(events.status, 200);
      assert(events.body.events.some((event: { type: string }) => event.type === 'promotion_evaluated'));

      const artifacts = await requestJson(listener.baseUrl, '/v1/runs/api-run/artifacts');
      assert.equal(artifacts.status, 200);
      assert(artifacts.body.artifacts.some((artifact: { kind: string }) => artifact.kind === 'patch'));
      assert(artifacts.body.artifacts.some((artifact: { kind: string }) => artifact.kind === 'review-bundle'));

      const approved = await requestJson(listener.baseUrl, '/v1/runs/api-run/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'operator', reason: 'ship it' }),
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.run.state, 'approved');

      const applied = await requestJson(listener.baseUrl, '/v1/runs/api-run/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(applied.status, 200);
      assert.equal(applied.body.run.state, 'applied');

      const completed = await requestJson(listener.baseUrl, '/v1/runs/api-run/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: 'done' }),
      });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.run.state, 'completed');

      const finalSnapshot = await requestJson(listener.baseUrl, '/v1/runs/api-run');
      assert.equal(finalSnapshot.status, 200);
      assert.equal(finalSnapshot.body.replay.currentState, 'completed');
      assert.equal(finalSnapshot.body.replay.applyStatus, 'applied');
      assert.equal(finalSnapshot.body.replay.reviewBundleArtifactIds.length, 1);
    } finally {
      await listener.close();
    }
  });
});

test('run-api classifies missing and conflicting lifecycle operations clearly', async () => {
  await withTempDir(async (baseDir) => {
    const server = createRunApiServer({
      baseDir,
      actor: 'api-tester',
      runtimeGateway: {
        baseUrl: 'http://127.0.0.1:9',
        maxTokensDefault: 256,
      },
    });
    const listener = await listen(server);
    try {
      const missing = await requestJson(listener.baseUrl, '/v1/runs/missing/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'nobody' }),
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.body.error, 'run_not_found');

      const badRequest = await requestJson(listener.baseUrl, '/v1/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(badRequest.status, 400);
      assert.equal(badRequest.body.error, 'bad_request');

      await requestJson(listener.baseUrl, '/v1/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: buildExecutableEditIntent('api-conflict') }),
      });
      const conflict = await requestJson(listener.baseUrl, '/v1/runs/api-conflict/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error, 'apply_requires_approved_run');

      const invalidRunCommand = await requestJson(listener.baseUrl, '/v1/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: buildRunCommandIntent('api-run-command', 'node -e "process.stdout.write(1)"') }),
      });
      assert.equal(invalidRunCommand.status, 400);
      assert.equal(invalidRunCommand.body.error, 'bad_request');
    } finally {
      await listener.close();
    }
  });
});

test('run-api serializes repeated lifecycle operations and returns duplicate conflict codes', async () => {
  await withTempDir(async (baseDir) => {
    const server = createRunApiServer({
      baseDir,
      actor: 'api-tester',
      runtimeGateway: {
        baseUrl: 'http://127.0.0.1:9',
        maxTokensDefault: 256,
      },
    });
    const listener = await listen(server);
    try {
      const created = await requestJson(listener.baseUrl, '/v1/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: buildExecutableEditIntent('api-duplicate') }),
      });
      assert.equal(created.status, 201);

      const approved = await requestJson(listener.baseUrl, '/v1/runs/api-duplicate/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'operator', reason: 'approve once' }),
      });
      assert.equal(approved.status, 200);

      const duplicateApprove = await requestJson(listener.baseUrl, '/v1/runs/api-duplicate/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'operator', reason: 'approve twice' }),
      });
      assert.equal(duplicateApprove.status, 409);
      assert.equal(duplicateApprove.body.error, 'duplicate_approval');

      const [firstApply, secondApply] = await Promise.all([
        requestJson(listener.baseUrl, '/v1/runs/api-duplicate/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
        requestJson(listener.baseUrl, '/v1/runs/api-duplicate/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ]);
      const applyStatuses = [firstApply.status, secondApply.status].sort((left, right) => left - right);
      assert.deepEqual(applyStatuses, [200, 409]);
      const duplicateApply = [firstApply, secondApply].find((result) => result.status === 409);
      assert.equal(duplicateApply?.body.error, 'duplicate_apply');

      const completed = await requestJson(listener.baseUrl, '/v1/runs/api-duplicate/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: 'done' }),
      });
      assert.equal(completed.status, 200);

      const duplicateComplete = await requestJson(listener.baseUrl, '/v1/runs/api-duplicate/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: 'again' }),
      });
      assert.equal(duplicateComplete.status, 409);
      assert.equal(duplicateComplete.body.error, 'duplicate_completion');
    } finally {
      await listener.close();
    }
  });
});