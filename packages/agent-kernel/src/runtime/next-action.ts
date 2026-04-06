import type { Intent } from '../intents/intent.types.js';
import type { RunState } from './state-machine.js';

export type RuntimeNextAction =
  | 'review_patch'
  | 'complete_run'
  | 'await_operator_approval'
  | 'apply_patch'
  | 'none';

export function selectNextAction(args: { currentState: RunState; intentType: Intent['type'] }): RuntimeNextAction {
  switch (args.currentState) {
    case 'executing':
      return args.intentType === 'edit_files' ? 'review_patch' : 'complete_run';
    case 'validated':
      return 'await_operator_approval';
    case 'approved':
      return 'apply_patch';
    case 'applied':
      return 'complete_run';
    default:
      return 'none';
  }
}