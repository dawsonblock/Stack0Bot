#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const rootDir = new URL('..', import.meta.url);
const packageJsonPath = join(rootDir.pathname, 'package.json');
const raw = await readFile(packageJsonPath, 'utf8');
const pkg = JSON.parse(raw);
const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
const disallowed = workspaces.filter((workspace) => workspace.startsWith('vendor/') || workspace.startsWith('references/'));

if (disallowed.length > 0) {
  throw new Error(`workspace manifest includes unsupported paths: ${disallowed.join(', ')}`);
}

process.stdout.write(`${JSON.stringify({ ok: true, workspaces }, null, 2)}\n`);