#!/usr/bin/env node
import process from 'node:process';

const gateway = process.env.GSD_RUNTIME_GATEWAY_URL || 'http://127.0.0.1:8787';
const gatewayToken = (process.env.GSD_RUNTIME_GATEWAY_BEARER || '').trim();
const runApiToken = (process.env.AGENT_STACK_RUN_API_BEARER || '').trim();
const command = process.argv[2] || 'status';
const runApi = process.env.AGENT_STACK_RUN_API_URL || 'http://127.0.0.1:8788';

async function get(base, path) {
  const headers = {};
  const token = base === runApi ? runApiToken : gatewayToken;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { headers: Object.keys(headers).length > 0 ? headers : undefined });
  const text = await res.text();
  let payload = text;
  try { payload = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, payload };
}

const usingRunApi = command === 'run-api' || command === 'runs';
const base = usingRunApi ? runApi : gateway;
const route = usingRunApi ? (command === 'runs' ? '/v1/runs' : '/healthz')
  : command === 'models' ? '/v1/models'
  : command === 'capabilities' ? '/v1/capabilities'
  : command === 'policy' ? '/v1/runtime/policy'
  : '/v1/runtime/status';

const result = await get(base, route);
if (!result.ok) {
  console.error(JSON.stringify(result.payload, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result.payload, null, 2));
if (route === '/v1/runtime/status' && result.payload?.degraded) {
  process.exit(3);
}
