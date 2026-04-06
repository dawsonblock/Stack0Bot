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
    return this.assertTransition(next);
  }

  assertTransition(next: RunState, reason?: string): RunState {
    const from = this.state;
    const allowed = TRANSITIONS[from];
    if (!allowed.includes(next)) {
      const allowedList = allowed.length > 0 ? allowed.join(', ') : 'none';
      throw new Error(`invalid transition: current=${from} attempted=${next} allowed=${allowedList}${reason ? ` (${reason})` : ''}`);
    }
    this.state = next;
    return this.state;
  }

  transitionOrThrow(next: RunState, reason?: string): RunState {
    return this.assertTransition(next, reason);
  }

  isTerminal(): boolean {
    return TERMINAL.has(this.state);
  }

  requiresApproval(): boolean {
    return this.state === 'proposed' || this.state === 'awaiting_approval' || this.state === 'validated';
  }
}
