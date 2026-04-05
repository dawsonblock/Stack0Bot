export const INTENT_TYPES = [
  'read_file',
  'search_code',
  'run_command',
  'edit_files',
  'model_call',
  'ask_user',
  'finalize',
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];
export type ReadonlyIntentType = 'read_file' | 'search_code' | 'run_command' | 'model_call' | 'ask_user';
export type MutatingIntentType = 'edit_files' | 'finalize';

export type IntentPolicy = {
  approvalRequired?: boolean;
  network?: 'deny' | 'allow';
};

export type IntentBase<TType extends IntentType> = {
  type: TType;
  runId: string;
  intentId: string;
  requestedBy: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  policy?: IntentPolicy;
};

export type ReadFileIntent = IntentBase<'read_file'> & {
  path: string;
  reason?: string;
};

export type SearchCodeIntent = IntentBase<'search_code'> & {
  query: string;
  cwd?: string;
  limit?: number;
};

export type RunCommandIntent = IntentBase<'run_command'> & {
  command: string;
  cwd?: string;
  allowNetwork?: boolean;
  timeoutMs?: number;
};

export type EditFileSpec = {
  path: string;
  content: string;
  encoding?: 'utf8';
};

export type ValidationOverride = {
  allowMissingExecutableValidators: boolean;
  reason: string;
};

export type EditFilesIntent = IntentBase<'edit_files'> & {
  edits: EditFileSpec[];
  reason: string;
  cwd?: string;
  declaredWriteSet: string[];
  validationOverride?: ValidationOverride;
};

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  name?: string;
};

export type ModelCallIntent = IntentBase<'model_call'> & {
  model: string;
  messages: ModelMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
};

export type AskUserIntent = IntentBase<'ask_user'> & {
  prompt: string;
  choices?: string[];
};

export type FinalizeIntent = IntentBase<'finalize'> & {
  summary: string;
  artifacts?: string[];
};

export type Intent =
  | ReadFileIntent
  | SearchCodeIntent
  | RunCommandIntent
  | EditFilesIntent
  | ModelCallIntent
  | AskUserIntent
  | FinalizeIntent;

export type IntentErrorCode =
  | 'invalid_intent'
  | 'policy_violation'
  | 'missing_handler'
  | 'execution_failed'
  | 'upstream_unavailable'
  | 'validation_failed';

export type IntentError = {
  code: IntentErrorCode;
  message: string;
  retriable: boolean;
};

export type IntentResult = {
  ok: boolean;
  intentType: IntentType;
  data?: unknown;
  error?: string;
  errorDetail?: IntentError;
  artifactIds?: string[];
  artifactPaths?: string[];
  proposed?: boolean;
};

export type ExecutionContext = {
  runId: string;
  worktreeDir: string;
  actor: string;
};
