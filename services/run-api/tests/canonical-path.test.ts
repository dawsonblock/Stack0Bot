import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunApiServer } from '../src/server.js';
import { listen, runCliJson, withTempDir, writeJsonFile } from '../../../tests/core-test-helpers.ts';

const shellCliPath = resolve(process.cwd(), 'apps/shell/bin/agent-stack-run.mjs');

function buildExecutableEditIntent() {
  return {
    type: 'edit_files',
    requestedBy: 'operator',
    reason: 'Create a smoke fixture through the canonical path',
    declaredWriteSet: ['package.json', 'greeting.js', 'greeting.test.js'],
    edits: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'smoke-fixture',
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
        content: "export function greet() {\n  return 'smoke-ok';\n}\n",
      },
      {
        path: 'greeting.test.js',
        content: [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          '',
          "import { greet } from './greeting.js';",
          '',
          "test('greet returns the smoke sentinel', () => {",
          "  assert.equal(greet(), 'smoke-ok');",
          '});',
          '',
        ].join('\n'),
      },
    ],
  };
}

test('shell -> run-api -> agent-kernel -> runtime-gateway canonical path remains bounded', async () => {
  await withTempDir(async (baseDir) => {
    let modelCallCount = 0;
    const gatewayServer = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        modelCallCount += 1;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'smoke-ok' }, finish_reason: 'stop' }],
        }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    const gateway = await listen(gatewayServer);
    const runApiServer = createRunApiServer({
      baseDir,
      actor: 'operator',
      logger: () => {},
      runtimeGateway: {
        baseUrl: gateway.baseUrl,
        maxTokensDefault: 256,
      },
    });
    const runApi = await listen(runApiServer);
    const env = {
      ...process.env,
      AGENT_STACK_RUN_API_URL: runApi.baseUrl,
      AGENT_STACK_MODEL: 'local-qwen-coder',
      AGENT_STACK_ACTOR: 'operator',
    };

    try {
      const readonlyRun = await runCliJson(shellCliPath, ['prompt', 'Respond with the exact string smoke-ok.'], env);
      const readonlyRunId = readonlyRun.run.runId as string;
      const readonlySnapshot = await runCliJson(shellCliPath, ['get', readonlyRunId], env);
      assert.equal(readonlySnapshot.run.state, 'completed');
      const readonlyEvents = await runCliJson(shellCliPath, ['events', readonlyRunId], env);
      assert(readonlyEvents.events.some((event: { type: string }) => event.type === 'model_called'));
      assert.equal(modelCallCount, 1);

      const intentPath = join(baseDir, 'mutating-intent.json');
      await writeJsonFile(intentPath, buildExecutableEditIntent());
      const mutatingRun = await runCliJson(shellCliPath, ['start-file', intentPath], env);
      const mutatingRunId = mutatingRun.run.runId as string;
      const beforeApply = await runCliJson(shellCliPath, ['get', mutatingRunId], env);
      assert.equal(beforeApply.run.state, 'validated');
      await assert.rejects(() => access(join(beforeApply.worktreeDir, 'greeting.js')));

      await runCliJson(shellCliPath, ['approve', mutatingRunId, 'looks good'], env);
      await runCliJson(shellCliPath, ['apply', mutatingRunId], env);
      const afterApply = await runCliJson(shellCliPath, ['get', mutatingRunId], env);
      const appliedContent = await readFile(join(afterApply.worktreeDir, 'greeting.js'), 'utf8');
      assert.equal(appliedContent.includes('smoke-ok'), true);

      await runCliJson(shellCliPath, ['complete', mutatingRunId, 'complete'], env);
      const afterComplete = await runCliJson(shellCliPath, ['get', mutatingRunId], env);
      assert.equal(afterComplete.run.state, 'completed');
      assert.equal(await readFile(join(afterComplete.worktreeDir, 'greeting.js'), 'utf8'), appliedContent);
      const mutatingEvents = await runCliJson(shellCliPath, ['events', mutatingRunId], env);
      assert(mutatingEvents.events.some((event: { type: string }) => event.type === 'validator_executed'));
    } finally {
      await runApi.close();
      await gateway.close();
    }
  });
});