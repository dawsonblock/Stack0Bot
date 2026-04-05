import { spawn } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { evaluateNetworkPolicy } from './network-policy.js';

export type SandboxCommandSpec = {
  command: string;
  args?: string[];
};

export type SandboxPolicy = {
  worktreeDir: string;
  allowNetwork: boolean;
  timeoutMs: number;
  allowedCommands?: string[];
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
};

export type SandboxCapabilityReport = {
  filesystemScoped: boolean;
  networkIsolated: boolean;
  networkIsolationSupported: boolean;
  networkIsolationEnforced: boolean;
  networkAccessActual: 'allow' | 'deny' | 'degraded';
  timeoutEnforced: boolean;
  allowlistEnforced: boolean;
  mode: 'isolated' | 'restricted';
};

export type SandboxInvocation = {
  command: string;
  args: string[];
  cwd: string;
};

export type SandboxResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  invocation: SandboxInvocation;
  capability: SandboxCapabilityReport;
  policyDecision: ReturnType<typeof evaluateNetworkPolicy>;
};

const DISALLOWED_COMMAND_SNIPPETS = ['\n', '\r', ';', '|', '&', '<', '>', '`', '$(', '${'];

function ensureWithinWorktree(cwd: string, worktreeDir: string): string {
  const resolvedCwd = resolve(cwd);
  const resolvedRoot = resolve(worktreeDir);
  const rel = relative(resolvedRoot, resolvedCwd);
  if (rel.startsWith('..')) {
    throw new Error(`cwd escapes worktree: ${cwd}`);
  }
  return resolvedCwd;
}

function rejectUnsafeCommandSyntax(command: string): void {
  for (const snippet of DISALLOWED_COMMAND_SNIPPETS) {
    if (command.includes(snippet)) {
      throw new Error(`unsupported shell syntax in command: ${snippet}`);
    }
  }
}

export function parseSandboxCommand(command: string): SandboxCommandSpec {
  const input = command.trim();
  if (!input) {
    throw new Error('sandbox command must not be empty');
  }

  rejectUnsafeCommandSyntax(input);

  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaping = false;
  let tokenStarted = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      tokenStarted = true;
      continue;
    }

    if (quote === 'single') {
      if (char === "'") {
        quote = null;
        tokenStarted = true;
      } else {
        current += char;
        tokenStarted = true;
      }
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
        tokenStarted = true;
      } else if (char === '\\') {
        escaping = true;
      } else {
        current += char;
        tokenStarted = true;
      }
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === "'") {
      quote = 'single';
      tokenStarted = true;
      continue;
    }

    if (char === '"') {
      quote = 'double';
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (escaping || quote !== null) {
    throw new Error('unterminated escape or quote in sandbox command');
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  if (tokens.length === 0 || !tokens[0]) {
    throw new Error('sandbox command must include an executable');
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

function normalizeCommand(command: string | SandboxCommandSpec): SandboxCommandSpec {
  if (typeof command === 'string') {
    return parseSandboxCommand(command);
  }

  if (!command.command.trim()) {
    throw new Error('sandbox command must include an executable');
  }

  return {
    command: command.command,
    args: command.args ?? [],
  };
}

function allowlistKey(command: SandboxCommandSpec): string {
  return basename(command.command);
}

export async function runInSandbox(command: string | SandboxCommandSpec, cwd: string, policy: SandboxPolicy): Promise<SandboxResult> {
  const parsed = normalizeCommand(command);
  const safeCwd = ensureWithinWorktree(join(policy.worktreeDir, cwd || '.'), policy.worktreeDir);
  const allowlistedCommand = allowlistKey(parsed);
  if (policy.allowedCommands?.length && !policy.allowedCommands.includes(allowlistedCommand)) {
    throw new Error(`command "${allowlistedCommand}" not allowlisted`);
  }

  const network = evaluateNetworkPolicy(policy.allowNetwork ? 'allow' : 'deny');
  const capability: SandboxCapabilityReport = {
    filesystemScoped: true,
    networkIsolated: network.actual === 'deny',
    networkIsolationSupported: network.supported,
    networkIsolationEnforced: network.enforced,
    networkAccessActual: network.actual,
    timeoutEnforced: true,
    allowlistEnforced: Boolean(policy.allowedCommands?.length),
    mode: network.mode,
  };

  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_STACK_SANDBOX_MODE: capability.mode };
  if (!policy.allowNetwork) {
    env.AGENT_STACK_NETWORK_DISABLED = '1';
  }

  const maxStdout = policy.maxStdoutBytes ?? 256 * 1024;
  const maxStderr = policy.maxStderrBytes ?? 256 * 1024;

  return new Promise<SandboxResult>((resolvePromise) => {
    const startedAt = Date.now();
    const invocation: SandboxInvocation = {
      command: parsed.command,
      args: parsed.args ?? [],
      cwd: safeCwd,
    };
    const child = spawn(parsed.command, parsed.args ?? [], {
      cwd: safeCwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number | null, error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        stderr = stderr ? `${stderr}\n${error.message}` : error.message;
      }
      resolvePromise({
        ok: !timedOut && !error && exitCode === 0,
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
        invocation,
        capability,
        policyDecision: network,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, policy.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > maxStdout) {
        stdout = stdout.slice(0, maxStdout);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr, 'utf8') > maxStderr) {
        stderr = stderr.slice(0, maxStderr);
      }
    });

    child.on('error', (error) => {
      finish(null, error);
    });

    child.on('close', (exitCode) => {
      finish(exitCode ?? null);
    });
  });
}
