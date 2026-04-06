import type { Intent, IntentType } from './intent.types.js';

export type IntentContractStatus = 'supported' | 'reserved_unsupported';

export type IntentMetadata = {
  supportedRuntime: boolean;
  mutating: boolean;
  requiredFields: string[];
  contractStatus: IntentContractStatus;
};

const INTENT_METADATA: Record<IntentType, IntentMetadata> = {
  read_file: {
    supportedRuntime: true,
    mutating: false,
    requiredFields: ['path'],
    contractStatus: 'supported',
  },
  search_code: {
    supportedRuntime: true,
    mutating: false,
    requiredFields: ['query'],
    contractStatus: 'supported',
  },
  run_command: {
    supportedRuntime: false,
    mutating: false,
    requiredFields: ['command'],
    contractStatus: 'reserved_unsupported',
  },
  edit_files: {
    supportedRuntime: true,
    mutating: true,
    requiredFields: ['reason', 'declaredWriteSet', 'edits'],
    contractStatus: 'supported',
  },
  model_call: {
    supportedRuntime: true,
    mutating: false,
    requiredFields: ['model', 'messages'],
    contractStatus: 'supported',
  },
  ask_user: {
    supportedRuntime: true,
    mutating: false,
    requiredFields: ['prompt'],
    contractStatus: 'supported',
  },
  finalize: {
    supportedRuntime: true,
    mutating: true,
    requiredFields: ['summary'],
    contractStatus: 'supported',
  },
};

export function getIntentMetadata(type: IntentType): IntentMetadata {
  return INTENT_METADATA[type];
}

export function buildIntentPayloadSummary(intent: Intent): Record<string, unknown> {
  switch (intent.type) {
    case 'read_file':
      return { path: intent.path };
    case 'search_code':
      return {
        query: intent.query,
        cwd: intent.cwd ?? '.',
        limit: intent.limit ?? 50,
      };
    case 'run_command':
      return {
        command: intent.command,
        cwd: intent.cwd ?? '.',
        allowNetwork: Boolean(intent.allowNetwork),
        timeoutMs: intent.timeoutMs ?? 60_000,
      };
    case 'edit_files':
      return {
        reason: intent.reason,
        declaredWriteSet: intent.declaredWriteSet,
        editCount: intent.edits.length,
        cwd: intent.cwd ?? '.',
        validationOverride: Boolean(intent.validationOverride),
      };
    case 'model_call':
      return {
        model: intent.model,
        messageCount: intent.messages.length,
        maxTokens: intent.maxTokens,
        temperature: intent.temperature ?? 0,
        stream: Boolean(intent.stream),
      };
    case 'ask_user':
      return {
        prompt: intent.prompt,
        choiceCount: intent.choices?.length ?? 0,
      };
    case 'finalize':
      return {
        summary: intent.summary,
        artifactCount: intent.artifacts?.length ?? 0,
      };
  }
}