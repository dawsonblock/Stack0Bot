import type { AgentEvent } from './event-types.js';

export type ReplayedRunState = {
  currentState: string;
  artifactIds: string[];
  intentCount: number;
  validationOk: boolean | null;
  approvalStatus: 'unknown' | 'approved' | 'rejected';
  outcome: 'running' | 'completed' | 'failed';
};

export function replayRun(events: AgentEvent[]): ReplayedRunState {
  let currentState = 'created';
  let intentCount = 0;
  const artifactIds: string[] = [];
  let validationOk: boolean | null = null;
  let approvalStatus: 'unknown' | 'approved' | 'rejected' = 'unknown';
  let outcome: 'running' | 'completed' | 'failed' = 'running';

  for (const event of events) {
    if (event.type === 'intent_received') intentCount += 1;
    if (event.type === 'artifact_written' && typeof event.artifactId === 'string') artifactIds.push(event.artifactId);
    if (event.type === 'state_transition' && typeof event.to === 'string') currentState = event.to;
    if (event.type === 'promotion_evaluated' && typeof event.ok === 'boolean') validationOk = event.ok;
    if (event.type === 'approval_recorded') {
      approvalStatus = event.approved ? 'approved' : 'rejected';
    }
    if (event.type === 'run_completed') outcome = 'completed';
    if (event.type === 'run_failed') outcome = 'failed';
  }

  return { currentState, artifactIds, intentCount, validationOk, approvalStatus, outcome };
}
