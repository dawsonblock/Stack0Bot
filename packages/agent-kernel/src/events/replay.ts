import type { AgentEvent } from './event-types.js';

export type ReplayedRunState = {
  currentState: string;
  artifactIds: string[];
  artifactIdsByKind: Record<string, string[]>;
  reviewBundleArtifactIds: string[];
  intentCount: number;
  validationOk: boolean | null;
  validationSummary?: string;
  validationOverrideRecorded: boolean;
  approvalStatus: 'unknown' | 'approved' | 'rejected';
  applyStatus: 'not_requested' | 'requested' | 'applied';
  outcome: 'running' | 'completed' | 'failed';
  failureReason?: string;
  completedAt?: string;
};

export function replayRun(events: AgentEvent[]): ReplayedRunState {
  let currentState = 'created';
  let intentCount = 0;
  const artifactIds: string[] = [];
  const artifactIdsByKind: Record<string, string[]> = {};
  let validationOk: boolean | null = null;
  let validationSummary: string | undefined;
  let validationOverrideRecorded = false;
  let approvalStatus: 'unknown' | 'approved' | 'rejected' = 'unknown';
  let applyStatus: 'not_requested' | 'requested' | 'applied' = 'not_requested';
  let outcome: 'running' | 'completed' | 'failed' = 'running';
  let failureReason: string | undefined;
  let completedAt: string | undefined;

  for (const event of events) {
    if (event.type === 'intent_received') intentCount += 1;
    if (event.type === 'artifact_written' && typeof event.artifactId === 'string') {
      artifactIds.push(event.artifactId);
      if (typeof event.artifactKind === 'string') {
        artifactIdsByKind[event.artifactKind] ??= [];
        artifactIdsByKind[event.artifactKind].push(event.artifactId);
      }
    }
    if (event.type === 'state_transition' && typeof event.to === 'string') currentState = event.to;
    if (event.type === 'promotion_evaluated' && typeof event.ok === 'boolean') {
      validationOk = event.ok;
      if (typeof event.summary === 'string') {
        validationSummary = event.summary;
      }
    }
    if (event.type === 'validation_override_recorded') {
      validationOverrideRecorded = true;
    }
    if (event.type === 'approval_recorded') {
      approvalStatus = event.approved ? 'approved' : 'rejected';
    }
    if (event.type === 'artifact_apply_requested') applyStatus = 'requested';
    if (event.type === 'artifact_applied') applyStatus = 'applied';
    if (event.type === 'run_completed') {
      outcome = 'completed';
      completedAt = event.timestamp;
    }
    if (event.type === 'run_failed') {
      outcome = 'failed';
      if (typeof event.reason === 'string') {
        failureReason = event.reason;
      }
    }
  }

  return {
    currentState,
    artifactIds,
    artifactIdsByKind,
    reviewBundleArtifactIds: artifactIdsByKind['review-bundle'] ?? [],
    intentCount,
    validationOk,
    validationSummary,
    validationOverrideRecorded,
    approvalStatus,
    applyStatus,
    outcome,
    failureReason,
    completedAt,
  };
}
