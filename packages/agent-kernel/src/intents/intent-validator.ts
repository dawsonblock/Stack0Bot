import { randomUUID } from 'node:crypto';
import { INTENT_TYPES, type Intent, type EditFilesIntent, type ModelCallIntent, type ValidationOverride } from './intent.types.js';

export const MAX_EDIT_COUNT = 32;
export const MAX_EDIT_BYTES = 512 * 1024;
export const MAX_MODEL_MESSAGES = 64;
export const MAX_MODEL_TOKENS = 8192;

function ensureKnownType(value: string): void {
  if (!INTENT_TYPES.includes(value as (typeof INTENT_TYPES)[number])) {
    throw new Error(`unknown intent type: ${value}`);
  }
}

function isSafeRelativePath(input: string): boolean {
  if (!input || input.trim() === '') return false;
  if (input.startsWith('/') || input.startsWith('\\')) return false;
  if (input.includes('..')) return false;
  return true;
}

function normalizeBaseFields(intent: Intent): Intent {
  return {
    ...intent,
    intentId: intent.intentId || randomUUID(),
    requestedBy: intent.requestedBy || 'unknown',
    createdAt: intent.createdAt || new Date().toISOString(),
    policy: intent.policy ?? {},
  } as Intent;
}

function validateValidationOverride(override: ValidationOverride | undefined): void {
  if (!override) {
    return;
  }

  if (!override.allowMissingExecutableValidators) {
    throw new Error('validationOverride.allowMissingExecutableValidators must be true when override is provided');
  }

  if (!override.reason.trim()) {
    throw new Error('validationOverride.reason is required when override is provided');
  }
}

function validateEditIntent(intent: EditFilesIntent): void {
  if (!intent.reason.trim()) throw new Error('edit_files.reason is required');
  if (!Array.isArray(intent.declaredWriteSet) || intent.declaredWriteSet.length === 0) {
    throw new Error('edit_files.declaredWriteSet is required');
  }
  if (!Array.isArray(intent.edits) || intent.edits.length === 0) throw new Error('edit_files.edits must not be empty');
  if (intent.edits.length > MAX_EDIT_COUNT) throw new Error(`too many edits; max ${MAX_EDIT_COUNT}`);
  let totalBytes = 0;
  const declared = new Set(intent.declaredWriteSet);
  for (const edit of intent.edits) {
    if (!isSafeRelativePath(edit.path)) throw new Error(`unsafe edit path: ${edit.path}`);
    if (!declared.has(edit.path)) throw new Error(`edit path not declared in write set: ${edit.path}`);
    totalBytes += Buffer.byteLength(edit.content, 'utf8');
  }
  if (totalBytes > MAX_EDIT_BYTES) throw new Error(`edit payload too large; max ${MAX_EDIT_BYTES} bytes`);
  if (intent.cwd && !isSafeRelativePath(intent.cwd) && intent.cwd !== '.') throw new Error(`unsafe cwd: ${intent.cwd}`);
  validateValidationOverride(intent.validationOverride);
}

function validateModelIntent(intent: ModelCallIntent): void {
  if (!intent.model.trim()) throw new Error('model_call.model is required');
  if (!Array.isArray(intent.messages) || intent.messages.length === 0) throw new Error('model_call.messages must not be empty');
  if (intent.messages.length > MAX_MODEL_MESSAGES) throw new Error(`too many model messages; max ${MAX_MODEL_MESSAGES}`);
  const bounded = intent.maxTokens ?? 2048;
  if (bounded <= 0 || bounded > MAX_MODEL_TOKENS) throw new Error(`maxTokens must be between 1 and ${MAX_MODEL_TOKENS}`);
}

export function validateIntent(intent: Intent): Intent {
  ensureKnownType(intent.type);
  const normalized = normalizeBaseFields(intent);
  if (!normalized.runId.trim()) throw new Error('runId is required');

  switch (normalized.type) {
    case 'read_file':
      if (!isSafeRelativePath(normalized.path)) throw new Error(`unsafe read path: ${normalized.path}`);
      return normalized;
    case 'search_code':
      if (!normalized.query.trim()) throw new Error('search_code.query is required');
      if (normalized.cwd && !isSafeRelativePath(normalized.cwd) && normalized.cwd !== '.') throw new Error(`unsafe cwd: ${normalized.cwd}`);
      return { ...normalized, cwd: normalized.cwd ?? '.', limit: Math.max(1, Math.min(normalized.limit ?? 50, 200)) };
    case 'run_command':
      if (!normalized.command.trim()) throw new Error('run_command.command is required');
      if (normalized.cwd && !isSafeRelativePath(normalized.cwd) && normalized.cwd !== '.') throw new Error(`unsafe cwd: ${normalized.cwd}`);
      return { ...normalized, cwd: normalized.cwd ?? '.', timeoutMs: Math.max(1000, Math.min(normalized.timeoutMs ?? 60_000, 300_000)) };
    case 'edit_files':
      validateEditIntent(normalized);
      return { ...normalized, cwd: normalized.cwd ?? '.', policy: { approvalRequired: true, ...(normalized.policy ?? {}) } };
    case 'model_call':
      validateModelIntent(normalized);
      return { ...normalized, maxTokens: Math.min(normalized.maxTokens ?? 2048, MAX_MODEL_TOKENS) };
    case 'ask_user':
      if (!normalized.prompt.trim()) throw new Error('ask_user.prompt is required');
      return normalized;
    case 'finalize':
      if (!normalized.summary.trim()) throw new Error('finalize.summary is required');
      return { ...normalized, policy: { approvalRequired: true, ...(normalized.policy ?? {}) } };
  }
}
