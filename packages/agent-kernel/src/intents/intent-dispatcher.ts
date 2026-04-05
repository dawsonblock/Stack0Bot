import type { Intent, IntentResult, IntentError } from './intent.types.js';

export type IntentHandler = (intent: Intent) => Promise<IntentResult>;

export class IntentDispatcher {
  private readonly handlers = new Map<Intent['type'], IntentHandler>();

  register<TType extends Intent['type']>(type: TType, handler: IntentHandler): void {
    this.handlers.set(type, handler);
  }

  async dispatch(intent: Intent): Promise<IntentResult> {
    const handler = this.handlers.get(intent.type);
    if (!handler) {
      const error: IntentError = {
        code: 'missing_handler',
        message: `no handler registered for ${intent.type}`,
        retriable: false,
      };
      return { ok: false, intentType: intent.type, error: error.message, errorDetail: error };
    }
    return handler(intent);
  }

  async dispatchOrThrow(intent: Intent): Promise<IntentResult> {
    const result = await this.dispatch(intent);
    if (!result.ok) {
      throw new Error(`[${intent.intentId}] ${result.errorDetail?.code ?? 'execution_failed'}: ${result.error ?? 'dispatch failed'}`);
    }
    return result;
  }
}
