import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export async function makeTempDir(prefix = 'agent-stack-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function withTempDir<T>(fn: (path: string) => Promise<T>, prefix = 'agent-stack-test-'): Promise<T> {
  const path = await makeTempDir(prefix);
  try {
    return await fn(path);
  } finally {
    await removeTempDir(path);
  }
}

export async function listen(server: Server): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = (address as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

export async function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body,
  };
}

export async function runCliJson(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<any> {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const [exitCode] = await once(child, 'exit');
  if (exitCode !== 0) {
    throw new Error(`CLI exited with code ${exitCode}: ${stderr || stdout}`);
  }

  return JSON.parse(stdout);
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}