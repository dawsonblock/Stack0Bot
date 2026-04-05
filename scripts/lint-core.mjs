#!/usr/bin/env node
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

await run('npx', ['tsc', '-b', '--pretty', 'false']);
await run('node', ['--check', 'apps/shell/bin/agent-stack-shell.mjs']);
await run('node', ['--check', 'apps/shell/bin/agent-stack-run.mjs']);
await run('python3', ['-m', 'py_compile', 'services/runtime-gateway/app.py']);