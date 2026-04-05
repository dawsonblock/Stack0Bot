import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function makeTempDir(prefix = 'agent-stack-test-') {
    return mkdtemp(join(tmpdir(), prefix));
}
export async function removeTempDir(path) {
    await rm(path, { recursive: true, force: true });
}
export async function withTempDir(fn, prefix = 'agent-stack-test-') {
    const path = await makeTempDir(prefix);
    try {
        return await fn(path);
    }
    finally {
        await removeTempDir(path);
    }
}
export async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const port = address.port;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: async () => {
            server.close();
            await once(server, 'close');
        },
    };
}
export async function requestJson(baseUrl, path, init) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let body = text;
    try {
        body = text ? JSON.parse(text) : null;
    }
    catch {
        body = text;
    }
    return {
        status: response.status,
        body,
    };
}
export async function runCliJson(scriptPath, args, env) {
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
export async function writeJsonFile(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export async function readText(path) {
    return readFile(path, 'utf8');
}
//# sourceMappingURL=core-test-helpers.js.map