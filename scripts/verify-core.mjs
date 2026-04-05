#!/usr/bin/env node
import process from 'node:process';
import { spawn } from 'node:child_process';

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

const includeSmoke = process.argv.includes('--smoke');
const npm = npmCommand();

for (const script of ['build', 'lint', 'test']) {
  await run(npm, ['run', script]);
}

if (includeSmoke) {
  await run(npm, ['run', 'smoke']);
}