export type RunState =
  | 'created'
  | 'planning'
  | 'awaiting_action'
  | 'executing'
  | 'proposed'
  | 'awaiting_approval'
  | 'validated'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'completed'
  | 'failed';

const TRANSITIONS: Record<RunState, RunState[]> = {
  created: ['planning', 'failed'],
  planning: ['awaiting_action', 'failed'],
  awaiting_action: ['executing', 'failed'],
  executing: ['proposed', 'completed', 'failed'],
  proposed: ['awaiting_approval', 'failed'],
  awaiting_approval: ['validated', 'approved', 'rejected', 'failed'],
  validated: ['approved', 'rejected', 'failed'],
  approved: ['applied', 'failed'],
  rejected: ['failed'],
  applied: ['completed', 'failed'],
  completed: [],
  failed: [],
};

const TERMINAL = new Set<RunState>(['completed', 'failed']);

export class RunStateMachine {
  constructor(private state: RunState = 'created') {}

  get current(): RunState {
    return this.state;
  }

  canTransition(next: RunState): boolean {
    return TRANSITIONS[this.state].includes(next);
  }

  transition(next: RunState): RunState {
    return this.transitionOrThrow(next);
  }

  transitionOrThrow(next: RunState, reason?: string): RunState {
    if (!this.canTransition(next)) {
      throw new Error(`invalid transition: ${this.state} -> ${next}${reason ? ` (${reason})` : ''}`);
    }
    this.state = next;
    return this.state;
  }

  isTerminal(): boolean {
    return TERMINAL.has(this.state);
  }

  requiresApproval(): boolean {
    return this.state === 'proposed' || this.state === 'awaiting_approval' || this.state === 'validated';
  }
}
