
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { LocalRunApi, RunBadRequestError, isRunOperationError, type Intent } from '@agent-stack/agent-kernel';

export type RunApiServerOptions = {
  baseDir: string;
  actor: string;
  port?: number;
  runtimeGateway: {
    baseUrl: string;
    bearerToken?: string;
    maxTokensDefault: number;
  };
};

export function resolveRunApiServerOptions(env: NodeJS.ProcessEnv = process.env): RunApiServerOptions {
  return {
    baseDir: env.AGENT_STACK_BASE_DIR || process.cwd(),
    port: Number(env.AGENT_STACK_RUN_API_PORT || '8788'),
    actor: env.AGENT_STACK_ACTOR || 'operator',
    runtimeGateway: {
      baseUrl: env.GSD_RUNTIME_GATEWAY_URL || 'http://127.0.0.1:8787',
      bearerToken: (env.GSD_RUNTIME_GATEWAY_BEARER || '').trim() || undefined,
      maxTokensDefault: Number(env.AGENT_STACK_RUNTIME_GATEWAY_MAX_TOKENS || '2048'),
    },
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RunBadRequestError('invalid_json', 'request body must be valid JSON');
  }
}

function notFound(res: ServerResponse) {
  sendJson(res, 404, { error: 'not_found' });
}

function classifyError(error: unknown): { status: number; code: string; message: string } {
  if (isRunOperationError(error)) {
    return { status: error.status, code: error.code, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, code: 'run_api_error', message };
}

function runRoute(pathname: string) {
  const match = pathname.match(/^\/v1\/runs\/([^/]+)(?:\/(events|artifacts|approve|reject|apply|complete))?$/);
  if (!match) return null;
  return { runId: decodeURIComponent(match[1]), action: match[2] || null };
}

function buildIntent(input: any, defaultActor: string): Intent {
  const candidate = input && typeof input === 'object' && 'intent' in input ? input.intent : input;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || typeof (candidate as { type?: unknown }).type !== 'string') {
    throw new RunBadRequestError('missing_intent', 'request body must include an intent object');
  }
  const intent = candidate as Partial<Intent> & Record<string, unknown>;
  const now = new Date().toISOString();
  return {
    ...intent,
    requestedBy: typeof intent.requestedBy === 'string' && intent.requestedBy.trim() ? intent.requestedBy : defaultActor,
    createdAt: typeof intent.createdAt === 'string' && intent.createdAt.trim() ? intent.createdAt : now,
    runId: typeof intent.runId === 'string' && intent.runId.trim() ? intent.runId : randomUUID(),
    intentId: typeof intent.intentId === 'string' && intent.intentId.trim() ? intent.intentId : randomUUID(),
  } as Intent;
}

export function createRunApiServer(options: RunApiServerOptions) {
  const api = new LocalRunApi({
    baseDir: options.baseDir,
    actor: options.actor,
    runtimeGateway: options.runtimeGateway,
  });

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const { pathname } = url;

      if (req.method === 'GET' && pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, service: 'run-api', baseDir: options.baseDir, actor: options.actor, runtimeGateway: options.runtimeGateway.baseUrl });
      }

      if (req.method === 'GET' && pathname === '/v1/runs') {
        const runs = await api.listRuns();
        return sendJson(res, 200, { runs });
      }

      if (req.method === 'POST' && pathname === '/v1/runs') {
        const body = await readJson(req);
        const run = await api.createRun(buildIntent(body, options.actor));
        return sendJson(res, 201, { run });
      }

      const routed = runRoute(pathname);
      if (!routed) return notFound(res);

      if (req.method === 'GET' && routed.action === null) {
        const snapshot = await api.getRun(routed.runId);
        if (!snapshot.run) return notFound(res);
        return sendJson(res, 200, snapshot);
      }

      if (req.method === 'GET' && routed.action === 'events') {
        return sendJson(res, 200, { runId: routed.runId, events: await api.getRunEvents(routed.runId) });
      }

      if (req.method === 'GET' && routed.action === 'artifacts') {
        return sendJson(res, 200, { runId: routed.runId, artifacts: await api.getRunArtifacts(routed.runId) });
      }

      if (req.method === 'POST' && routed.action === 'approve') {
        const body = await readJson(req);
        const run = await api.approveRun(routed.runId, body.actor || options.actor, body.reason);
        return sendJson(res, 200, { run });
      }

      if (req.method === 'POST' && routed.action === 'reject') {
        const body = await readJson(req);
        const run = await api.rejectRun(routed.runId, body.actor || options.actor, body.reason);
        return sendJson(res, 200, { run });
      }

      if (req.method === 'POST' && routed.action === 'apply') {
        const run = await api.applyRun(routed.runId);
        return sendJson(res, 200, { run });
      }

      if (req.method === 'POST' && routed.action === 'complete') {
        const body = await readJson(req);
        const run = await api.completeRun(routed.runId, body.notes);
        return sendJson(res, 200, { run });
      }

      return notFound(res);
    } catch (error) {
      const classified = classifyError(error);
      return sendJson(res, classified.status, { error: classified.code, message: classified.message });
    }
  });
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const options = resolveRunApiServerOptions();
  const server = createRunApiServer(options);
  server.listen(options.port, () => {
    console.log(JSON.stringify({ ok: true, service: 'run-api', port: options.port, baseDir: options.baseDir, actor: options.actor, runtimeGateway: options.runtimeGateway.baseUrl }));
  });
}
