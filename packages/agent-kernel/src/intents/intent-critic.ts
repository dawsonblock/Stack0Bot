import { INTENT_TYPES, type IntentType } from './intent.types.js';
import { getIntentMetadata } from './intent-metadata.js';

export type IntentCritiqueIssue = {
  code: 'missing_intent_type' | 'unknown_intent_type' | 'missing_required_field' | 'approval_context_required';
  field?: string;
  message: string;
};

export type IntentCritique = {
  ok: boolean;
  issues: IntentCritiqueIssue[];
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function critiqueIntentCandidate(candidate: unknown): IntentCritique {
  const issues: IntentCritiqueIssue[] = [];

  if (!isObjectRecord(candidate)) {
    return {
      ok: false,
      issues: [{ code: 'missing_intent_type', field: 'type', message: 'intent.type is required' }],
    };
  }

  const rawType = candidate.type;
  if (typeof rawType !== 'string' || rawType.trim() === '') {
    return {
      ok: false,
      issues: [{ code: 'missing_intent_type', field: 'type', message: 'intent.type is required' }],
    };
  }

  const intentType = rawType.trim() as IntentType;
  if (!INTENT_TYPES.includes(intentType)) {
    return {
      ok: false,
      issues: [{ code: 'unknown_intent_type', field: 'type', message: `unknown intent type: ${rawType}` }],
    };
  }

  const metadata = getIntentMetadata(intentType);
  for (const field of metadata.requiredFields) {
    const value = candidate[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      issues.push({
        code: 'missing_required_field',
        field,
        message: `${intentType}.${field} is required`,
      });
    }
  }

  const policy = isObjectRecord(candidate.policy) ? candidate.policy : null;
  if (metadata.mutating && policy?.approvalRequired === true && !candidate.approvalContext) {
    issues.push({
      code: 'approval_context_required',
      field: 'approvalContext',
      message: `${intentType} requires approval context before execution`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}