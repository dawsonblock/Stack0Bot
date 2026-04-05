import { runInSandbox, type SandboxCommandSpec } from '@agent-stack/sandbox';

import type { Validator, ValidationContext, ValidationResult } from './promotion-gate.js';

export type ExecutableValidationCommand = {
  command: SandboxCommandSpec;
  cwd?: string;
  timeoutMs?: number;
  source: string;
};

export type ExecutableValidationSelection =
  | {
      kind: 'command';
      command: ExecutableValidationCommand;
      detectedBy: string;
      summary?: string;
    }
  | {
      kind: 'not_applicable';
      summary: string;
      details?: Record<string, unknown>;
    }
  | {
      kind: 'missing_path';
      summary: string;
      details?: Record<string, unknown>;
    };

export abstract class ExecutableValidator implements Validator {
  abstract readonly name: string;

  protected abstract selectCommand(ctx: ValidationContext): Promise<ExecutableValidationSelection>;

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const selection = await this.selectCommand(ctx);
    if (selection.kind === 'not_applicable') {
      return {
        name: this.name,
        ok: true,
        severity: 'warn',
        summary: selection.summary,
        details: {
          ...(selection.details ?? {}),
          executionMode: 'not_applicable',
        },
      };
    }

    if (selection.kind === 'missing_path') {
      return {
        name: this.name,
        ok: false,
        severity: 'fail',
        summary: selection.summary,
        details: {
          ...(selection.details ?? {}),
          executionMode: 'missing_path',
          reasonCode: 'missing_executable_validation',
        },
      };
    }

    const validationRoot = ctx.stagedWorktreeDir ?? ctx.worktreeDir;
    const startedAt = Date.now();

    try {
      const result = await runInSandbox(selection.command.command, selection.command.cwd ?? '.', {
        worktreeDir: validationRoot,
        allowNetwork: false,
        timeoutMs: selection.command.timeoutMs ?? 120_000,
        allowedCommands: [selection.command.command.command],
      });

      const outputArtifact = await ctx.artifacts.writeJson(ctx.runId, 'command-output', {
        ...result,
        validatorName: this.name,
        validationSource: selection.command.source,
        detectedBy: selection.detectedBy,
      }, {
        validatorName: this.name,
        command: result.invocation.command,
        args: result.invocation.args,
        cwd: result.invocation.cwd,
      });
      await ctx.eventLog.append(ctx.runId, {
        type: 'artifact_written',
        artifactId: outputArtifact.id,
        artifactKind: outputArtifact.kind,
        validatorName: this.name,
      });

      const report = {
        validatorName: this.name,
        detectedBy: selection.detectedBy,
        source: selection.command.source,
        invocation: result.invocation,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        outputArtifactId: outputArtifact.id,
        outputArtifactPath: outputArtifact.path,
      };
      const reportArtifact = await ctx.artifacts.writeJson(ctx.runId, 'validator-report', report, {
        validatorName: this.name,
      });
      await ctx.eventLog.append(ctx.runId, {
        type: 'artifact_written',
        artifactId: reportArtifact.id,
        artifactKind: reportArtifact.kind,
        validatorName: this.name,
      });
      await ctx.eventLog.append(ctx.runId, {
        type: 'validator_executed',
        validatorName: this.name,
        command: result.invocation.command,
        args: result.invocation.args,
        cwd: result.invocation.cwd,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        outputArtifactId: outputArtifact.id,
        reportArtifactId: reportArtifact.id,
      });

      return {
        name: this.name,
        ok: result.ok,
        severity: result.ok ? 'pass' : 'fail',
        summary: result.ok
          ? selection.summary ?? `${this.name} completed successfully`
          : `${this.name} failed with exit code ${result.exitCode ?? 'null'}`,
        details: {
          executionMode: 'executed',
          detectedBy: selection.detectedBy,
          source: selection.command.source,
          command: result.invocation.command,
          args: result.invocation.args,
          cwd: result.invocation.cwd,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          outputArtifactId: outputArtifact.id,
          outputArtifactPath: outputArtifact.path,
          reportArtifactId: reportArtifact.id,
          reportArtifactPath: reportArtifact.path,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      const reportArtifact = await ctx.artifacts.writeJson(ctx.runId, 'validator-report', {
        validatorName: this.name,
        detectedBy: selection.detectedBy,
        source: selection.command.source,
        error: message,
        durationMs,
      }, {
        validatorName: this.name,
      });
      await ctx.eventLog.append(ctx.runId, {
        type: 'artifact_written',
        artifactId: reportArtifact.id,
        artifactKind: reportArtifact.kind,
        validatorName: this.name,
      });
      await ctx.eventLog.append(ctx.runId, {
        type: 'validator_executed',
        validatorName: this.name,
        command: selection.command.command.command,
        args: selection.command.command.args ?? [],
        cwd: selection.command.cwd ?? '.',
        exitCode: null,
        timedOut: false,
        durationMs,
        error: message,
        reportArtifactId: reportArtifact.id,
      });

      return {
        name: this.name,
        ok: false,
        severity: 'fail',
        summary: `${this.name} could not execute: ${message}`,
        details: {
          executionMode: 'execution_error',
          detectedBy: selection.detectedBy,
          source: selection.command.source,
          command: selection.command.command.command,
          args: selection.command.command.args ?? [],
          cwd: selection.command.cwd ?? '.',
          durationMs,
          error: message,
          reportArtifactId: reportArtifact.id,
          reportArtifactPath: reportArtifact.path,
        },
      };
    }
  }
}