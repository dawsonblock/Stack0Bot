
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { LocalRunApi, RunBadRequestError, RunPayloadTooLargeError, isRunOperationError, type Intent } from '@agent-stack/agent-kernel';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export type RunApiLogLevel = 'info' | 'warn' | 'error';

export type RunApiLogRecord = {
  timestamp: string;
  level: RunApiLogLevel;
  service: 'run-api';
  event: 'request_completed' | 'request_failed' | 'server_started';
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  runId?: string;
  errorCode?: string;
  message?: string;
  port?: number;
  baseDir?: string;
  actor?: string;
  runtimeGateway?: string;
  maxBodyBytes?: number;
};

export type RunApiLogger = (entry: RunApiLogRecord) => void;

export type RunApiServerOptions = {
  baseDir: string;
  actor: string;
  port?: number;
  maxBodyBytes?: number;
  logger?: RunApiLogger;
  runtimeGateway: {
    baseUrl: string;
    bearerToken?: string;
    maxTokensDefault: number;
  };
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return fallback;
  }
  return Math.floor(value as number);
}

function defaultLogger(entry: RunApiLogRecord) {
  console.log(JSON.stringify(entry));
}

function logRunApiRecord(logger: RunApiLogger, entry: RunApiLogRecord) {
  logger(entry);
}

function classifyLogLevel(status: number): RunApiLogLevel {
  if (status >= 500) {
    return 'error';
  }
  if (status >= 400) {
    return 'warn';
  }
  return 'info';
}

function requestIdFrom(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  if (Array.isArray(header) && typeof header[0] === 'string' && header[0].trim()) {
    return header[0].trim();
  }
  return randomUUID();
}

export function resolveRunApiServerOptions(env: NodeJS.ProcessEnv = process.env): RunApiServerOptions {
  return {
    baseDir: env.AGENT_STACK_BASE_DIR || process.cwd(),
    port: Number(env.AGENT_STACK_RUN_API_PORT || '8788'),
    actor: env.AGENT_STACK_ACTOR || 'operator',
    maxBodyBytes: normalizePositiveInteger(Number(env.AGENT_STACK_RUN_API_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES), DEFAULT_MAX_BODY_BYTES),
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

async function readJson(req: IncomingMessage, maxBodyBytes: number): Promise<any> {
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string') {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBodyBytes) {
      throw new RunPayloadTooLargeError(`request body exceeds ${maxBodyBytes} bytes`);
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new RunPayloadTooLargeError(`request body exceeds ${maxBodyBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RunBadRequestError('invalid_json', 'request body must be valid JSON');
  }
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
  const logger = options.logger ?? defaultLogger;
  const maxBodyBytes = normalizePositiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES);

  return createServer(async (req, res) => {
    const requestId = requestIdFrom(req);
    const startedAt = Date.now();
    const method = req.method || 'GET';
    let pathname = req.url || '/';
    let runId: string | undefined;

    const respond = (status: number, payload: unknown, meta?: { errorCode?: string; message?: string }) => {
      sendJson(res, status, payload);
      logRunApiRecord(logger, {
        timestamp: new Date().toISOString(),
        level: classifyLogLevel(status),
        service: 'run-api',
        event: status >= 400 ? 'request_failed' : 'request_completed',
        requestId,
        method,
        path: pathname,
        status,
        durationMs: Date.now() - startedAt,
        runId,
        errorCode: meta?.errorCode,
        message: meta?.message,
      });
    };

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      pathname = url.pathname;

      if (method === 'GET' && pathname === '/healthz') {
        return respond(200, {
          ok: true,
          service: 'run-api',
          baseDir: options.baseDir,
          actor: options.actor,
          runtimeGateway: options.runtimeGateway.baseUrl,
        });
      }

      if (method === 'GET' && pathname === '/v1/runs') {
        const runs = await api.listRuns();
        return respond(200, { runs });
      }

      if (method === 'POST' && pathname === '/v1/runs') {
        const body = await readJson(req, maxBodyBytes);
        const intent = buildIntent(body, options.actor);
        runId = intent.runId;
        const run = await api.createRun(intent);
        return respond(201, { run });
      }

      const routed = runRoute(pathname);
      if (!routed) {
        return respond(404, { error: 'not_found' }, { errorCode: 'not_found', message: 'route not found' });
      }
      runId = routed.runId;

      if (method === 'GET' && routed.action === null) {
        const snapshot = await api.getRun(routed.runId);
        if (!snapshot.run) {
          return respond(404, { error: 'not_found' }, { errorCode: 'not_found', message: 'route not found' });
        }
        return respond(200, snapshot);
      }

      if (method === 'GET' && routed.action === 'events') {
        return respond(200, { runId: routed.runId, events: await api.getRunEvents(routed.runId) });
      }

      if (method === 'GET' && routed.action === 'artifacts') {
        return respond(200, { runId: routed.runId, artifacts: await api.getRunArtifacts(routed.runId) });
      }

      if (method === 'POST' && routed.action === 'approve') {
        const body = await readJson(req, maxBodyBytes);
        const run = await api.approveRun(routed.runId, body.actor || options.actor, body.reason);
        return respond(200, { run });
      }

      if (method === 'POST' && routed.action === 'reject') {
        const body = await readJson(req, maxBodyBytes);
        const run = await api.rejectRun(routed.runId, body.actor || options.actor, body.reason);
        return respond(200, { run });
      }

      if (method === 'POST' && routed.action === 'apply') {
        const run = await api.applyRun(routed.runId);
        return respond(200, { run });
      }

      if (method === 'POST' && routed.action === 'complete') {
        const body = await readJson(req, maxBodyBytes);
        const run = await api.completeRun(routed.runId, body.notes);
        return respond(200, { run });
      }

      return respond(404, { error: 'not_found' }, { errorCode: 'not_found', message: 'route not found' });
    } catch (error) {
      const classified = classifyError(error);
      return respond(classified.status, { error: classified.code, message: classified.message }, { errorCode: classified.code, message: classified.message });
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
    const logger = options.logger ?? defaultLogger;
    logRunApiRecord(logger, {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'run-api',
      event: 'server_started',
      port: options.port,
      baseDir: options.baseDir,
      actor: options.actor,
      runtimeGateway: options.runtimeGateway.baseUrl,
      maxBodyBytes: normalizePositiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES),
    });
  });
}
