export type AgentEventType =
  | 'run_created'
  | 'execution_started'
  | 'execution_finished'
  | 'intent_received'
  | 'intent_validated'
  | 'intent_rejected'
  | 'state_transition'
  | 'artifact_written'
  | 'artifact_apply_requested'
  | 'artifact_applied'
  | 'command_executed'
  | 'validator_executed'
  | 'model_called'
  | 'promotion_evaluated'
  | 'validation_override_recorded'
  | 'approval_recorded'
  | 'run_completed'
  | 'run_failed'
  | 'sandbox_capability_report';

export type AgentEvent = {
  type: AgentEventType;
  runId: string;
  timestamp: string;
  schemaVersion: 1;
  [key: string]: unknown;
};
