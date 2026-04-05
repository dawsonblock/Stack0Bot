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

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function isSafeRelativePath(input: unknown): input is string {
  if (typeof input !== 'string' || input.trim() === '') return false;
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

  requireNonEmptyString(override.reason, 'validationOverride.reason');
}

function validateEditIntent(intent: EditFilesIntent): void {
  requireNonEmptyString(intent.reason, 'edit_files.reason');
  if (!Array.isArray(intent.declaredWriteSet) || intent.declaredWriteSet.length === 0) {
    throw new Error('edit_files.declaredWriteSet is required');
  }
  if (!Array.isArray(intent.edits) || intent.edits.length === 0) throw new Error('edit_files.edits must not be empty');
  if (intent.edits.length > MAX_EDIT_COUNT) throw new Error(`too many edits; max ${MAX_EDIT_COUNT}`);
  let totalBytes = 0;
  const declared = new Set(intent.declaredWriteSet);
  for (const edit of intent.edits) {
    if (typeof edit.content !== 'string') throw new Error(`edit content must be a utf8 string: ${edit.path}`);
    if (!isSafeRelativePath(edit.path)) throw new Error(`unsafe edit path: ${edit.path}`);
    if (!declared.has(edit.path)) throw new Error(`edit path not declared in write set: ${edit.path}`);
    totalBytes += Buffer.byteLength(edit.content, 'utf8');
  }
  if (totalBytes > MAX_EDIT_BYTES) throw new Error(`edit payload too large; max ${MAX_EDIT_BYTES} bytes`);
  if (intent.cwd && !isSafeRelativePath(intent.cwd) && intent.cwd !== '.') throw new Error(`unsafe cwd: ${intent.cwd}`);
  validateValidationOverride(intent.validationOverride);
}

function validateModelIntent(intent: ModelCallIntent): void {
  requireNonEmptyString(intent.model, 'model_call.model');
  if (!Array.isArray(intent.messages) || intent.messages.length === 0) throw new Error('model_call.messages must not be empty');
  if (intent.messages.length > MAX_MODEL_MESSAGES) throw new Error(`too many model messages; max ${MAX_MODEL_MESSAGES}`);
  const bounded = intent.maxTokens ?? 2048;
  if (bounded <= 0 || bounded > MAX_MODEL_TOKENS) throw new Error(`maxTokens must be between 1 and ${MAX_MODEL_TOKENS}`);
}

function validateRunCommandIntent(intent: Extract<Intent, { type: 'run_command' }>): void {
  requireNonEmptyString(intent.command, 'run_command.command');
  throw new Error('run_command is not part of the supported runtime');
}

export function validateIntent(intent: Intent): Intent {
  requireNonEmptyString(intent.type, 'intent.type');
  ensureKnownType(intent.type);
  const normalized = normalizeBaseFields(intent);
  requireNonEmptyString(normalized.runId, 'runId');

  switch (normalized.type) {
    case 'read_file':
      if (!isSafeRelativePath(normalized.path)) throw new Error(`unsafe read path: ${normalized.path}`);
      return normalized;
    case 'search_code':
      requireNonEmptyString(normalized.query, 'search_code.query');
      if (normalized.cwd && !isSafeRelativePath(normalized.cwd) && normalized.cwd !== '.') throw new Error(`unsafe cwd: ${normalized.cwd}`);
      return { ...normalized, cwd: normalized.cwd ?? '.', limit: Math.max(1, Math.min(normalized.limit ?? 50, 200)) };
    case 'run_command':
      if (normalized.cwd && !isSafeRelativePath(normalized.cwd) && normalized.cwd !== '.') throw new Error(`unsafe cwd: ${normalized.cwd}`);
      validateRunCommandIntent(normalized);
      return { ...normalized, cwd: normalized.cwd ?? '.', allowNetwork: false, timeoutMs: Math.max(1000, Math.min(normalized.timeoutMs ?? 60_000, 120_000)) };
    case 'edit_files':
      validateEditIntent(normalized);
      return { ...normalized, cwd: normalized.cwd ?? '.', policy: { approvalRequired: true, ...(normalized.policy ?? {}) } };
    case 'model_call':
      validateModelIntent(normalized);
      return { ...normalized, maxTokens: Math.min(normalized.maxTokens ?? 2048, MAX_MODEL_TOKENS) };
    case 'ask_user':
      requireNonEmptyString(normalized.prompt, 'ask_user.prompt');
      return normalized;
    case 'finalize':
      requireNonEmptyString(normalized.summary, 'finalize.summary');
      return { ...normalized, policy: { approvalRequired: true, ...(normalized.policy ?? {}) } };
  }
}
