import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import type { ArtifactStore } from '../artifacts/artifact-store.js';
import { buildPatchArtifact } from '../artifacts/patch-artifact.js';
import type { EventLog } from '../events/event-log.js';
import { critiqueIntentCandidate } from '../intents/intent-critic.js';
import { buildIntentPayloadSummary, getIntentMetadata } from '../intents/intent-metadata.js';
import type { Intent, IntentResult, ExecutionContext, ModelCallIntent } from '../intents/intent.types.js';
import { runInSandbox, type SandboxCommandSpec } from '@agent-stack/sandbox';

export type RuntimeGatewayConfig = {
  baseUrl: string;
  bearerToken?: string;
  maxTokensDefault: number;
};

function stringifyCommand(command: SandboxCommandSpec): string {
  return [command.command, ...(command.args ?? [])].join(' ');
}

function resolveWorktreePath(worktreeDir: string, relativePath: string): string {
  const target = resolve(join(worktreeDir, relativePath));
  const rel = relative(resolve(worktreeDir), target);
  if (rel.startsWith('..')) throw new Error(`path escapes worktree: ${relativePath}`);
  return target;
}

function unsupportedIntentMessage(intentType: Intent['type'], contractStatus: ReturnType<typeof getIntentMetadata>['contractStatus']): string {
  if (contractStatus === 'reserved_unsupported') {
    return `${intentType} is reserved in the intent schema but not supported by this runtime`;
  }
  return `${intentType} is not part of the supported runtime`;
}

async function callRuntimeGateway(config: RuntimeGatewayConfig, intent: ModelCallIntent): Promise<{ status: number; payload: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.bearerToken) headers.authorization = `Bearer ${config.bearerToken}`;
  const body = {
    model: intent.model,
    messages: intent.messages,
    max_tokens: Math.min(intent.maxTokens ?? config.maxTokensDefault, config.maxTokensDefault),
    temperature: intent.temperature ?? 0,
    stream: Boolean(intent.stream),
  };
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

export class ExecutionAuthority {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly artifacts: ArtifactStore,
    private readonly eventLog: EventLog,
    private readonly runtimeGateway: RuntimeGatewayConfig,
  ) {}

  async execute(intent: Intent): Promise<IntentResult> {
    const metadata = getIntentMetadata(intent.type);
    const critique = critiqueIntentCandidate(intent);
    const blockingIssues = critique.issues.filter((issue) => issue.code !== 'approval_context_required');
    await this.eventLog.append(intent.runId, {
      type: 'intent_received',
      actor: this.ctx.actor,
      intentId: intent.intentId,
      intentType: intent.type,
      payload: buildIntentPayloadSummary(intent),
    });

    if (blockingIssues.length > 0) {
      return {
        ok: false,
        intentType: intent.type,
        data: { issues: blockingIssues },
        error: blockingIssues[0]?.message ?? 'intent rejected at execution boundary',
        errorDetail: {
          code: 'validation_failed',
          message: blockingIssues[0]?.message ?? 'intent rejected at execution boundary',
          retriable: false,
        },
      };
    }

    if (!metadata.supportedRuntime) {
      const message = unsupportedIntentMessage(intent.type, metadata.contractStatus);
      return {
        ok: false,
        intentType: intent.type,
        error: message,
        errorDetail: {
          code: 'policy_violation',
          message,
          retriable: false,
        },
      };
    }

    switch (intent.type) {
      case 'read_file': {
        const target = resolveWorktreePath(this.ctx.worktreeDir, intent.path);
        const content = await readFile(target, 'utf8');
        const artifact = await this.artifacts.writeJson(intent.runId, 'summary', {
          path: intent.path,
          bytes: Buffer.byteLength(content, 'utf8'),
        }, { intentId: intent.intentId, path: intent.path });
        await this.eventLog.append(intent.runId, { type: 'artifact_written', artifactId: artifact.id, artifactKind: artifact.kind, intentId: intent.intentId });
        return { ok: true, intentType: intent.type, data: { content }, artifactIds: [artifact.id], artifactPaths: [artifact.path] };
      }
      case 'search_code': {
        const command: SandboxCommandSpec = {
          command: 'rg',
          args: ['--line-number', '--hidden', '--glob', '!node_modules', '--glob', '!vendor', '-m', String(intent.limit ?? 50), intent.query, '.'],
        };
        const result = await runInSandbox(
          command,
          intent.cwd || '.',
          {
            worktreeDir: this.ctx.worktreeDir,
            allowNetwork: false,
            timeoutMs: 20_000,
            allowedCommands: ['rg'],
          },
        );
        await this.eventLog.append(intent.runId, { type: 'sandbox_capability_report', capability: result.capability, policyDecision: result.policyDecision });
        const artifact = await this.artifacts.writeJson(intent.runId, 'command-output', result, {
          command: stringifyCommand(command),
          argv: command.args ?? [],
          query: intent.query,
          intentId: intent.intentId,
        });
        await this.eventLog.append(intent.runId, {
          type: 'command_executed',
          intentId: intent.intentId,
          command: result.invocation.command,
          args: result.invocation.args,
          cwd: result.invocation.cwd,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        });
        await this.eventLog.append(intent.runId, { type: 'artifact_written', artifactId: artifact.id, artifactKind: artifact.kind, intentId: intent.intentId });
        return { ok: result.ok, intentType: intent.type, data: result, artifactIds: [artifact.id], artifactPaths: [artifact.path], error: result.ok ? undefined : result.stderr || 'search failed' };
      }
      case 'run_command': {
        const message = unsupportedIntentMessage(intent.type, metadata.contractStatus);
        return {
          ok: false,
          intentType: intent.type,
          error: message,
          errorDetail: {
            code: 'policy_violation',
            message,
            retriable: false,
          },
        };
      }
      case 'edit_files': {
        const beforeContent: Record<string, string | null> = {};
        for (const edit of intent.edits) {
          const target = resolveWorktreePath(this.ctx.worktreeDir, edit.path);
          try {
            beforeContent[edit.path] = await readFile(target, 'utf8');
          } catch {
            beforeContent[edit.path] = null;
          }
        }
        const patch = buildPatchArtifact({
          runId: intent.runId,
          intentId: intent.intentId,
          requestedBy: intent.requestedBy,
          proposedBy: this.ctx.actor,
          reason: intent.reason,
          declaredWriteSet: intent.declaredWriteSet,
          edits: intent.edits,
          beforeContent,
        });
        const artifact = await this.artifacts.writeJson(intent.runId, 'patch', patch, { intentId: intent.intentId, changedFiles: patch.changedFiles });
        await this.eventLog.append(intent.runId, { type: 'artifact_written', artifactId: artifact.id, artifactKind: artifact.kind, intentId: intent.intentId });
        return {
          ok: true,
          intentType: intent.type,
          data: { changedFiles: patch.changedFiles, patchId: patch.patchId, diffFormat: patch.diffFormat },
          artifactIds: [artifact.id],
          artifactPaths: [artifact.path],
          proposed: true,
        };
      }
      case 'model_call': {
        const response = await callRuntimeGateway(this.runtimeGateway, intent);
        const artifact = await this.artifacts.writeJson(intent.runId, 'model-output', response.payload, { intentId: intent.intentId, model: intent.model, status: response.status });
        await this.eventLog.append(intent.runId, { type: 'model_called', intentId: intent.intentId, model: intent.model, status: response.status });
        await this.eventLog.append(intent.runId, { type: 'artifact_written', artifactId: artifact.id, artifactKind: artifact.kind, intentId: intent.intentId });
        return {
          ok: response.status < 400,
          intentType: intent.type,
          data: response.payload,
          artifactIds: [artifact.id],
          artifactPaths: [artifact.path],
          error: response.status < 400 ? undefined : `runtime gateway returned ${response.status}`,
        };
      }
      case 'ask_user': {
        return {
          ok: true,
          intentType: intent.type,
          data: {
            prompt: intent.prompt,
            choices: intent.choices ?? [],
            requiresHuman: true,
          },
          artifactIds: [],
          artifactPaths: [],
        };
      }
      case 'finalize': {
        const artifact = await this.artifacts.writeJson(intent.runId, 'summary', {
          summary: intent.summary,
          artifacts: intent.artifacts ?? [],
        }, { intentId: intent.intentId });
        await this.eventLog.append(intent.runId, { type: 'artifact_written', artifactId: artifact.id, artifactKind: artifact.kind, intentId: intent.intentId });
        return { ok: true, intentType: intent.type, data: { summary: intent.summary }, artifactIds: [artifact.id], artifactPaths: [artifact.path] };
      }
    }
  }
}
