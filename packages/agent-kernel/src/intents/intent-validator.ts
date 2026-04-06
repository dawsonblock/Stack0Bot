import { randomUUID } from 'node:crypto';
import { normalize } from 'node:path';
import { INTENT_TYPES, type Intent, type EditFilesIntent, type ModelCallIntent, type ValidationOverride } from './intent.types.js';
import { getIntentMetadata } from './intent-metadata.js';
import { utcNowIso } from '../time.js';

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
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} is required`);
  }
  const normalized = value.trim();
  if (normalized === '') {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function isSafeRelativePath(input: unknown): input is string {
  if (typeof input !== 'string' || input.trim() === '') return false;
  if (input.startsWith('/') || input.startsWith('\\')) return false;
  if (input.includes('..')) return false;
  return true;
}

function normalizeSafeRelativePath(input: unknown, fieldName: string, options: { allowDot?: boolean } = {}): string {
  const value = requireNonEmptyString(input, fieldName);
  const normalized = normalize(value).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!options.allowDot && normalized === '.') {
    throw new Error(`unsafe ${fieldName}: ${value}`);
  }
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`unsafe ${fieldName}: ${value}`);
  }
  return normalized;
}

function normalizeBaseFields(intent: Intent): Intent {
  return {
    ...intent,
    type: requireNonEmptyString(intent.type, 'intent.type') as Intent['type'],
    runId: requireNonEmptyString(intent.runId, 'runId'),
    intentId: typeof intent.intentId === 'string' && intent.intentId.trim() ? intent.intentId.trim() : randomUUID(),
    requestedBy: typeof intent.requestedBy === 'string' && intent.requestedBy.trim() ? intent.requestedBy.trim() : 'unknown',
    createdAt: typeof intent.createdAt === 'string' && intent.createdAt.trim() ? intent.createdAt.trim() : utcNowIso(),
    policy: intent.policy ?? {},
  } as Intent;
}

function assertRequiredFields(intent: Record<string, unknown>, prefix: string, fields: string[]): void {
  for (const field of fields) {
    const value = intent[field];
    if (value === undefined || value === null) {
      throw new Error(`${prefix}.${field} is required`);
    }
    if (typeof value === 'string' && value.trim() === '') {
      throw new Error(`${prefix}.${field} is required`);
    }
  }
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

function normalizeEditIntent(intent: EditFilesIntent): EditFilesIntent {
  const declaredWriteSet = intent.declaredWriteSet.map((path, index) => normalizeSafeRelativePath(path, `edit_files.declaredWriteSet[${index}]`));
  const declared = new Set(declaredWriteSet);
  const edits = intent.edits.map((edit, index) => {
    const path = normalizeSafeRelativePath(edit.path, `edit_files.edits[${index}].path`);
    if (!declared.has(path)) {
      throw new Error(`edit path not declared in write set: ${path}`);
    }
    return {
      ...edit,
      path,
    };
  });

  return {
    ...intent,
    reason: requireNonEmptyString(intent.reason, 'edit_files.reason'),
    declaredWriteSet,
    edits,
    cwd: intent.cwd ? normalizeSafeRelativePath(intent.cwd, 'edit_files.cwd', { allowDot: true }) : '.',
  };
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
  const normalized = normalizeBaseFields(intent);
  ensureKnownType(normalized.type);
  const metadata = getIntentMetadata(normalized.type);
  assertRequiredFields(normalized as Record<string, unknown>, normalized.type, metadata.requiredFields);

  switch (normalized.type) {
    case 'read_file':
      return {
        ...normalized,
        path: normalizeSafeRelativePath(normalized.path, 'read_file.path'),
      };
    case 'search_code':
      return {
        ...normalized,
        query: requireNonEmptyString(normalized.query, 'search_code.query'),
        cwd: normalized.cwd ? normalizeSafeRelativePath(normalized.cwd, 'search_code.cwd', { allowDot: true }) : '.',
        limit: Math.max(1, Math.min(normalized.limit ?? 50, 200)),
      };
    case 'run_command':
      validateRunCommandIntent({
        ...normalized,
        command: requireNonEmptyString(normalized.command, 'run_command.command'),
      });
      return {
        ...normalized,
        command: requireNonEmptyString(normalized.command, 'run_command.command'),
        cwd: normalized.cwd ? normalizeSafeRelativePath(normalized.cwd, 'run_command.cwd', { allowDot: true }) : '.',
        allowNetwork: false,
        timeoutMs: Math.max(1000, Math.min(normalized.timeoutMs ?? 60_000, 120_000)),
      };
    case 'edit_files':
      validateEditIntent(normalized);
      return { ...normalizeEditIntent(normalized), policy: { approvalRequired: true, ...(normalized.policy ?? {}) } };
    case 'model_call':
      validateModelIntent(normalized);
      return {
        ...normalized,
        model: requireNonEmptyString(normalized.model, 'model_call.model'),
        maxTokens: Math.min(normalized.maxTokens ?? 2048, MAX_MODEL_TOKENS),
      };
    case 'ask_user':
      return { ...normalized, prompt: requireNonEmptyString(normalized.prompt, 'ask_user.prompt') };
    case 'finalize':
      return {
        ...normalized,
        summary: requireNonEmptyString(normalized.summary, 'finalize.summary'),
        policy: { approvalRequired: true, ...(normalized.policy ?? {}) },
      };
  }
}
