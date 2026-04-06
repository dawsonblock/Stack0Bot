import type { AgentEvent } from './event-types.js';

export type ReplayedRunState = {
  currentState: string;
  intentType?: string;
  artifactIds: string[];
  artifactIdsByKind: Record<string, string[]>;
  reviewBundleArtifactIds: string[];
  intentCount: number;
  validationOk: boolean | null;
  validationSummary?: string;
  validationOverrideRecorded: boolean;
  approvalStatus: 'unknown' | 'approved' | 'rejected';
  approvalHistory: Array<{ approved: boolean; actor?: string; at?: string; reason?: string }>;
  applyStatus: 'not_requested' | 'requested' | 'applied';
  outcome: 'running' | 'completed' | 'failed';
  failureReason?: string;
  completedAt?: string;
  completionMode?: string;
  completionNotes?: string;
};

function asEventRecord(event: AgentEvent): Record<string, unknown> | null {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  return event as Record<string, unknown>;
}

export function replayRun(events: AgentEvent[]): ReplayedRunState {
  let currentState = 'created';
  let intentType: string | undefined;
  let intentCount = 0;
  const artifactIds: string[] = [];
  const artifactIdsByKind: Record<string, string[]> = {};
  let validationOk: boolean | null = null;
  let validationSummary: string | undefined;
  let validationOverrideRecorded = false;
  let approvalStatus: 'unknown' | 'approved' | 'rejected' = 'unknown';
  const approvalHistory: Array<{ approved: boolean; actor?: string; at?: string; reason?: string }> = [];
  let applyStatus: 'not_requested' | 'requested' | 'applied' = 'not_requested';
  let outcome: 'running' | 'completed' | 'failed' = 'running';
  let failureReason: string | undefined;
  let completedAt: string | undefined;
  let completionMode: string | undefined;
  let completionNotes: string | undefined;

  for (const rawEvent of events) {
    const event = asEventRecord(rawEvent);
    if (!event) {
      continue;
    }

    const type = typeof event.type === 'string' ? event.type : undefined;
    if (type === 'intent_received') {
      intentCount += 1;
      if (typeof event.intentType === 'string') {
        intentType = event.intentType;
      }
    }
    if (type === 'artifact_written' && typeof event.artifactId === 'string') {
      artifactIds.push(event.artifactId);
      if (typeof event.artifactKind === 'string') {
        artifactIdsByKind[event.artifactKind] ??= [];
        artifactIdsByKind[event.artifactKind].push(event.artifactId);
      }
    }
    if (type === 'state_transition' && typeof event.to === 'string') currentState = event.to;
    if (type === 'promotion_evaluated' && typeof event.ok === 'boolean') {
      validationOk = event.ok;
      if (typeof event.summary === 'string') {
        validationSummary = event.summary;
      }
    }
    if (type === 'validation_override_recorded') {
      validationOverrideRecorded = true;
    }
    if (type === 'approval_recorded' && typeof event.approved === 'boolean') {
      approvalStatus = event.approved ? 'approved' : 'rejected';
      approvalHistory.push({
        approved: event.approved,
        actor: typeof event.actor === 'string' ? event.actor : undefined,
        at: typeof event.timestamp === 'string' ? event.timestamp : undefined,
        reason: typeof event.reason === 'string' ? event.reason : undefined,
      });
    }
    if (type === 'artifact_apply_requested') applyStatus = 'requested';
    if (type === 'artifact_applied') applyStatus = 'applied';
    if (type === 'run_completed') {
      outcome = 'completed';
      if (typeof event.timestamp === 'string') {
        completedAt = event.timestamp;
      }
      if (typeof event.mode === 'string') {
        completionMode = event.mode;
      }
      if (typeof event.notes === 'string') {
        completionNotes = event.notes;
      }
    }
    if (type === 'run_failed') {
      outcome = 'failed';
      if (typeof event.reason === 'string') {
        failureReason = event.reason;
      }
    }
  }

  return {
    currentState,
    intentType,
    artifactIds,
    artifactIdsByKind,
    reviewBundleArtifactIds: artifactIdsByKind['review-bundle'] ?? [],
    intentCount,
    validationOk,
    validationSummary,
    validationOverrideRecorded,
    approvalStatus,
    approvalHistory,
    applyStatus,
    outcome,
    failureReason,
    completedAt,
    completionMode,
    completionNotes,
  };
}
