import type { EditFilesIntent, ValidationOverride } from '../intents/intent.types.js';
import type { PromotionDecision } from '../promotion/promotion-gate.js';
import type { PatchArtifact } from './patch-artifact.js';

export type ReviewBundle = {
  runId: string;
  generatedAt: string;
  requestedBy: string;
  generatedBy: string;
  intent: {
    type: 'edit_files';
    intentId: string;
    reason: string;
    declaredWriteSet: string[];
    requestedEditCount: number;
    changedFiles: string[];
  };
  patch: {
    artifactId: string;
    artifactPath: string;
    patchId: string;
    diffFormat: PatchArtifact['diffFormat'];
    changedFiles: string[];
    declaredWriteSet: string[];
  };
  validation: {
    ok: boolean;
    summary: string;
    requiresApproval: boolean;
    executedValidatorCount: number;
    results: PromotionDecision['results'];
  };
  override: {
    requested: boolean;
    allowMissingExecutableValidators: boolean;
    reason?: string;
    applied: boolean;
  };
  applyPreconditions: {
    beforeHashes: PatchArtifact['beforeHashes'];
    afterHashes: PatchArtifact['afterHashes'];
  };
};

export function buildReviewBundle(input: {
  runId: string;
  requestedBy: string;
  generatedBy: string;
  intent: Pick<EditFilesIntent, 'intentId' | 'reason' | 'declaredWriteSet' | 'edits'>;
  patchArtifactId: string;
  patchArtifactPath: string;
  patchArtifact: PatchArtifact;
  validation: PromotionDecision;
  validationOverride?: ValidationOverride;
}): ReviewBundle {
  return {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    requestedBy: input.requestedBy,
    generatedBy: input.generatedBy,
    intent: {
      type: 'edit_files',
      intentId: input.intent.intentId,
      reason: input.intent.reason,
      declaredWriteSet: input.intent.declaredWriteSet,
      requestedEditCount: input.intent.edits.length,
      changedFiles: input.patchArtifact.changedFiles,
    },
    patch: {
      artifactId: input.patchArtifactId,
      artifactPath: input.patchArtifactPath,
      patchId: input.patchArtifact.patchId,
      diffFormat: input.patchArtifact.diffFormat,
      changedFiles: input.patchArtifact.changedFiles,
      declaredWriteSet: input.patchArtifact.declaredWriteSet,
    },
    validation: {
      ok: input.validation.ok,
      summary: input.validation.summary,
      requiresApproval: input.validation.requiresApproval,
      executedValidatorCount: input.validation.executedValidatorCount,
      results: input.validation.results,
    },
    override: {
      requested: Boolean(input.validationOverride),
      allowMissingExecutableValidators: Boolean(input.validationOverride?.allowMissingExecutableValidators),
      reason: input.validationOverride?.reason,
      applied: Boolean(input.validation.overrideApplied),
    },
    applyPreconditions: {
      beforeHashes: input.patchArtifact.beforeHashes,
      afterHashes: input.patchArtifact.afterHashes,
    },
  };
}