#!/usr/bin/env node
import process from 'node:process';
import { randomUUID } from 'node:crypto';

const apiBase = process.env.AGENT_STACK_RUN_API_URL || 'http://127.0.0.1:8788';
const actor = process.env.AGENT_STACK_ACTOR || 'operator';
const model = process.env.AGENT_STACK_MODEL || 'local-qwen-coder';

function usage() {
  console.error(`Usage:
  agent-stack-run prompt <text>
  agent-stack-run start-json '<intent-json>'
  agent-stack-run start-file <intent.json>
  agent-stack-run list
  agent-stack-run get <runId>
  agent-stack-run events <runId>
  agent-stack-run artifacts <runId>
  agent-stack-run approve <runId> [reason]
  agent-stack-run reject <runId> [reason]
  agent-stack-run apply <runId>
  agent-stack-run complete <runId> [notes]`);
}

async function request(method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = text;
  try { payload = JSON.parse(text); } catch {}
  if (!res.ok) {
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) {
  usage();
  process.exit(2);
}

if (cmd === 'list') {
  await request('GET', '/v1/runs');
} else if (cmd === 'get') {
  const runId = rest[0];
  if (!runId) { usage(); process.exit(2); }
  await request('GET', `/v1/runs/${encodeURIComponent(runId)}`);
} else if (cmd === 'events') {
  const runId = rest[0];
  if (!runId) { usage(); process.exit(2); }
  await request('GET', `/v1/runs/${encodeURIComponent(runId)}/events`);
} else if (cmd === 'artifacts') {
  const runId = rest[0];
  if (!runId) { usage(); process.exit(2); }
  await request('GET', `/v1/runs/${encodeURIComponent(runId)}/artifacts`);
} else if (cmd === 'approve') {
  const [runId, ...reasonParts] = rest;
  if (!runId) { usage(); process.exit(2); }
  await request('POST', `/v1/runs/${encodeURIComponent(runId)}/approve`, { actor, reason: reasonParts.join(' ') || undefined });
} else if (cmd === 'reject') {
  const [runId, ...reasonParts] = rest;
  if (!runId) { usage(); process.exit(2); }
  await request('POST', `/v1/runs/${encodeURIComponent(runId)}/reject`, { actor, reason: reasonParts.join(' ') || undefined });
} else if (cmd === 'apply') {
  const runId = rest[0];
  if (!runId) { usage(); process.exit(2); }
  await request('POST', `/v1/runs/${encodeURIComponent(runId)}/apply`, {});
} else if (cmd === 'complete') {
  const [runId, ...notesParts] = rest;
  if (!runId) { usage(); process.exit(2); }
  await request('POST', `/v1/runs/${encodeURIComponent(runId)}/complete`, { notes: notesParts.join(' ') || undefined });
} else if (cmd === 'prompt') {
  const prompt = rest.join(' ').trim();
  if (!prompt) { usage(); process.exit(2); }
  const intent = {
    type: 'model_call',
    runId: randomUUID(),
    intentId: randomUUID(),
    requestedBy: actor,
    createdAt: new Date().toISOString(),
    model,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1024,
    temperature: 0,
    stream: false,
  };
  await request('POST', '/v1/runs', { intent });
} else if (cmd === 'start-json') {
  const raw = rest.join(' ').trim();
  if (!raw) { usage(); process.exit(2); }
  await request('POST', '/v1/runs', { intent: JSON.parse(raw) });
} else if (cmd === 'start-file') {
  const fs = await import('node:fs/promises');
  const file = rest[0];
  if (!file) { usage(); process.exit(2); }
  const raw = await fs.readFile(file, 'utf8');
  await request('POST', '/v1/runs', { intent: JSON.parse(raw) });
} else {
  usage();
  process.exit(2);
}
