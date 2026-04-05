#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const nodeTestGlobs = [
  'packages/agent-kernel/tests/*.test.ts',
  'services/run-api/tests/*.test.ts',
  'services/sandbox/tests/*.test.ts',
];

await run('node', ['--import', 'tsx', '--test', ...nodeTestGlobs]);
if (await exists('services/runtime-gateway/tests')) {
  await run('python3', ['-m', 'unittest', 'discover', '-s', 'services/runtime-gateway/tests', '-p', 'test_*.py']);
}