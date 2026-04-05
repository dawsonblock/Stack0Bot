import type { ArtifactRecord, ArtifactStore } from '../artifacts/artifact-store.js';
import type { EventLog } from '../events/event-log.js';
import type { ValidationOverride } from '../intents/intent.types.js';
import { prepareValidationWorktree } from './staged-worktree.js';

export type ValidationSeverity = 'pass' | 'warn' | 'fail';

export type ValidationResult = {
  name: string;
  ok: boolean;
  severity: ValidationSeverity;
  summary: string;
  details?: Record<string, unknown>;
};

export type ValidationContext = {
  runId: string;
  worktreeDir: string;
  stagedWorktreeDir?: string;
  patchArtifact?: ArtifactRecord;
  artifacts: ArtifactStore;
  eventLog: EventLog;
  actor: string;
  requestedBy: string;
  validationOverride?: ValidationOverride;
};

export interface Validator {
  readonly name: string;
  validate(ctx: ValidationContext): Promise<ValidationResult>;
}

export type PromotionDecision = {
  ok: boolean;
  requiresApproval: boolean;
  results: ValidationResult[];
  summary: string;
  recommendedNextState: 'validated' | 'failed';
  executedValidatorCount: number;
  overrideApplied?: boolean;
  overrideReason?: string;
};

export class PromotionGate {
  constructor(private readonly validators: Validator[]) {}

  private async ensureReportArtifact(ctx: ValidationContext, result: ValidationResult): Promise<ValidationResult> {
    if (result.details?.reportArtifactId) {
      return result;
    }

    const artifact = await ctx.artifacts.writeJson(ctx.runId, 'validator-report', {
      name: result.name,
      ok: result.ok,
      severity: result.severity,
      summary: result.summary,
      details: result.details ?? {},
    }, {
      validatorName: result.name,
    });
    await ctx.eventLog.append(ctx.runId, {
      type: 'artifact_written',
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      validatorName: result.name,
    });

    return {
      ...result,
      details: {
        ...(result.details ?? {}),
        reportArtifactId: artifact.id,
        reportArtifactPath: artifact.path,
      },
    };
  }

  private async recordValidationOverride(ctx: ValidationContext): Promise<ValidationResult> {
    const artifact = await ctx.artifacts.writeJson(ctx.runId, 'validator-report', {
      name: 'validation-override',
      requestedBy: ctx.requestedBy,
      recordedBy: ctx.actor,
      reason: ctx.validationOverride?.reason,
      allowMissingExecutableValidators: true,
      recordedAt: new Date().toISOString(),
    }, {
      validatorName: 'validation-override',
      overrideApplied: true,
    });
    await ctx.eventLog.append(ctx.runId, {
      type: 'artifact_written',
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      validatorName: 'validation-override',
    });
    await ctx.eventLog.append(ctx.runId, {
      type: 'validation_override_recorded',
      requestedBy: ctx.requestedBy,
      recordedBy: ctx.actor,
      reason: ctx.validationOverride?.reason,
      artifactId: artifact.id,
    });

    return {
      name: 'validation-override',
      ok: true,
      severity: 'warn',
      summary: 'missing executable validation path overridden explicitly',
      details: {
        executionMode: 'override',
        reasonCode: 'validation_override',
        reportArtifactId: artifact.id,
        reportArtifactPath: artifact.path,
        requestedBy: ctx.requestedBy,
        recordedBy: ctx.actor,
        reason: ctx.validationOverride?.reason,
      },
    };
  }

  async evaluate(ctx: ValidationContext): Promise<PromotionDecision> {
    if (!ctx.patchArtifact) {
      return {
        ok: false,
        requiresApproval: false,
        results: [{ name: 'patch-presence', ok: false, severity: 'fail', summary: 'mutating runs require a patch artifact' }],
        summary: 'missing patch artifact',
        recommendedNextState: 'failed',
        executedValidatorCount: 0,
      };
    }

    let cleanup: (() => Promise<void>) | undefined;
    try {
      const staged = await prepareValidationWorktree({
        runId: ctx.runId,
        worktreeDir: ctx.worktreeDir,
        patchArtifact: ctx.patchArtifact,
        artifacts: ctx.artifacts,
      });
      cleanup = staged.cleanup;
      const validationCtx: ValidationContext = {
        ...ctx,
        stagedWorktreeDir: staged.stagedWorktreeDir,
      };

      let results = await Promise.all(this.validators.map(async (validator) => {
        try {
          return await validator.validate(validationCtx);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            name: validator.name,
            ok: false,
            severity: 'fail' as const,
            summary: `${validator.name} threw during validation: ${message}`,
            details: {
              executionMode: 'validator_exception',
              reasonCode: 'validator_exception',
              error: message,
            },
          };
        }
      }));
      results = await Promise.all(results.map((result) => this.ensureReportArtifact(validationCtx, result)));

      const executedValidatorCount = results.filter((result) => result.details?.executionMode === 'executed').length;
      const resultsOk = results.every((result) => result.ok);
      let overrideApplied = false;
      let overrideReason: string | undefined;

      if (resultsOk && executedValidatorCount === 0) {
        if (validationCtx.validationOverride?.allowMissingExecutableValidators) {
          overrideApplied = true;
          overrideReason = validationCtx.validationOverride.reason;
          results = [...results, await this.recordValidationOverride(validationCtx)];
        } else {
          results = [...results, await this.ensureReportArtifact(validationCtx, {
            name: 'executable-validation',
            ok: false,
            severity: 'fail',
            summary: 'no executable validation path was available for this mutating run',
            details: {
              executionMode: 'missing_path',
              reasonCode: 'missing_executable_validation',
            },
          })];
        }
      }

      const ok = results.every((result) => result.ok);
      const summary = results.map((result) => `${result.name}:${result.severity}`).join(', ');
      return {
        ok,
        requiresApproval: true,
        results,
        summary,
        recommendedNextState: ok ? 'validated' : 'failed',
        executedValidatorCount,
        overrideApplied,
        overrideReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        requiresApproval: true,
        results: [{
          name: 'validation-runtime',
          ok: false,
          severity: 'fail',
          summary: `unable to stage validation workspace: ${message}`,
          details: {
            executionMode: 'validation_runtime_error',
            error: message,
          },
        }],
        summary: `validation-runtime:fail`,
        recommendedNextState: 'failed',
        executedValidatorCount: 0,
      };
    } finally {
      await cleanup?.();
    }
  }
}
