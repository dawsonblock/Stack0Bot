import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ArtifactStore, type ArtifactRecord } from '../artifacts/artifact-store.js';
import type { PatchArtifact } from '../artifacts/patch-artifact.js';
import { buildReviewBundle } from '../artifacts/review-bundle.js';
import { buildRunSummary } from '../artifacts/run-summary.js';
import { applyPatchArtifact } from '../apply/apply-artifact.js';
import { EventLog } from '../events/event-log.js';
import { replayRun } from '../events/replay.js';
import { RunConflictError, RunNotFoundError } from '../errors/run-errors.js';
import { IntentDispatcher } from '../intents/intent-dispatcher.js';
import type { Intent, IntentResult, ExecutionContext, ValidationOverride, EditFilesIntent } from '../intents/intent.types.js';
import { validateIntent } from '../intents/intent-validator.js';
import { PromotionGate, type PromotionDecision } from '../promotion/promotion-gate.js';
import { TestValidator } from '../promotion/validators/test-validator.js';
import { LintValidator } from '../promotion/validators/lint-validator.js';
import { DiffValidator } from '../promotion/validators/diff-validator.js';
import { SecurityValidator } from '../promotion/validators/security-validator.js';
import { ExecutionAuthority, type RuntimeGatewayConfig } from './execution-authority.js';
import { RunStateMachine, type RunState } from './state-machine.js';

export type RuntimeControllerOptions = {
  baseDir: string;
  actor: string;
  runtimeGateway: RuntimeGatewayConfig;
};

export type RunRecord = {
  runId: string;
  state: RunState;
  result?: IntentResult;
  validation?: PromotionDecision;
  validationOverrideRequested?: ValidationOverride;
  patchArtifactId?: string;
  reviewBundleArtifactId?: string;
  approval?: { approved: boolean; actor: string; at: string; reason?: string };
  startedAt: string;
};

export class RuntimeController {
  private readonly eventLog: EventLog;
  private readonly artifacts: ArtifactStore;
  private readonly runLocks = new Map<string, Promise<void>>();
  private readonly promotionGate = new PromotionGate([
    new TestValidator(),
    new LintValidator(),
    new DiffValidator(),
    new SecurityValidator(),
  ]);

  constructor(private readonly options: RuntimeControllerOptions) {
    this.eventLog = new EventLog(options.baseDir);
    this.artifacts = new ArtifactStore(options.baseDir);
  }

  private runRecordPath(runId: string): string {
    return join(this.options.baseDir, 'storage', 'runs', runId, 'run-record.json');
  }

  worktreeFor(runId: string): string {
    return join(this.options.baseDir, 'workspace', `run-${runId}`);
  }

  private async withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.runLocks.set(runId, tail);

    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      releaseCurrent();
      void tail.finally(() => {
        if (this.runLocks.get(runId) === tail) {
          this.runLocks.delete(runId);
        }
      });
    }
  }

  private async saveRun(record: RunRecord): Promise<void> {
    const path = this.runRecordPath(record.runId);
    await mkdir(join(this.options.baseDir, 'storage', 'runs', record.runId), { recursive: true });
    await writeFile(path, JSON.stringify(record, null, 2), 'utf8');
  }

  private async writeReviewBundle(args: {
    intent: EditFilesIntent;
    patchArtifactRecord: ArtifactRecord;
    validation: PromotionDecision;
  }): Promise<ArtifactRecord> {
    const patchArtifact = JSON.parse(await this.artifacts.read(args.patchArtifactRecord)) as PatchArtifact;
    const bundle = buildReviewBundle({
      runId: args.intent.runId,
      requestedBy: args.intent.requestedBy,
      generatedBy: this.options.actor,
      intent: args.intent,
      patchArtifactId: args.patchArtifactRecord.id,
      patchArtifactPath: args.patchArtifactRecord.path,
      patchArtifact,
      validation: args.validation,
      validationOverride: args.intent.validationOverride,
    });
    const artifact = await this.artifacts.writeJson(args.intent.runId, 'review-bundle', bundle, {
      patchArtifactId: args.patchArtifactRecord.id,
      validationOk: args.validation.ok,
      overrideApplied: Boolean(args.validation.overrideApplied),
    });
    await this.eventLog.append(args.intent.runId, {
      type: 'artifact_written',
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      patchArtifactId: args.patchArtifactRecord.id,
    });
    return artifact;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    try {
      const raw = await readFile(this.runRecordPath(runId), 'utf8');
      return JSON.parse(raw) as RunRecord;
    } catch {
      return null;
    }
  }

  async listRuns(): Promise<RunRecord[]> {
    const runsDir = join(this.options.baseDir, 'storage', 'runs');
    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const records = await Promise.all(runIds.map((runId) => this.getRun(runId)));
      return records.filter((record): record is RunRecord => Boolean(record));
    } catch {
      return [];
    }
  }

  async getEvents(runId: string) {
    return this.eventLog.readAll(runId);
  }

  async getArtifacts(runId: string) {
    return this.artifacts.list(runId);
  }

  async getReplay(runId: string) {
    const events = await this.getEvents(runId);
    return replayRun(events);
  }

  async getRunSnapshot(runId: string): Promise<{
    run: RunRecord | null;
    replay: ReturnType<typeof replayRun> | null;
    events: Awaited<ReturnType<RuntimeController['getEvents']>>;
    artifacts: Awaited<ReturnType<RuntimeController['getArtifacts']>>;
    worktreeDir: string;
  }> {
    const run = await this.getRun(runId);
    const events = await this.getEvents(runId);
    const artifacts = await this.getArtifacts(runId);
    return {
      run,
      replay: run ? replayRun(events) : null,
      events,
      artifacts,
      worktreeDir: this.worktreeFor(runId),
    };
  }

  private buildDispatcher(authority: ExecutionAuthority): IntentDispatcher {
    const dispatcher = new IntentDispatcher();
    for (const intentType of ['read_file', 'search_code', 'run_command', 'edit_files', 'model_call', 'ask_user', 'finalize'] as const) {
      dispatcher.register(intentType, async (registeredIntent) => authority.execute(registeredIntent));
    }
    return dispatcher;
  }

  async startRun(intent: Intent): Promise<RunRecord> {
    const validatedIntent = validateIntent(intent);
    return this.withRunLock(validatedIntent.runId, async () => {
      const existing = await this.getRun(validatedIntent.runId);
      if (existing) {
        throw new RunConflictError('duplicate_run', `run ${validatedIntent.runId} already exists`);
      }

      const state = new RunStateMachine('created');
      const worktreeDir = this.worktreeFor(validatedIntent.runId);
      await mkdir(worktreeDir, { recursive: true });

      const record: RunRecord = {
        runId: validatedIntent.runId,
        state: 'created',
        validationOverrideRequested: validatedIntent.type === 'edit_files' ? validatedIntent.validationOverride : undefined,
        startedAt: new Date().toISOString(),
      };
      await this.saveRun(record);
      await this.eventLog.append(validatedIntent.runId, { type: 'run_created', intentType: validatedIntent.type, intentId: validatedIntent.intentId });
      await this.eventLog.append(validatedIntent.runId, { type: 'intent_validated', intentId: validatedIntent.intentId, intentType: validatedIntent.type });

      const transition = async (next: RunState) => {
        const from = state.current;
        state.transitionOrThrow(next);
        record.state = state.current;
        await this.saveRun(record);
        await this.eventLog.append(validatedIntent.runId, { type: 'state_transition', from, to: next });
      };

      await transition('planning');
      await transition('awaiting_action');
      await transition('executing');

      const ctx: ExecutionContext = { runId: validatedIntent.runId, actor: this.options.actor, worktreeDir };
      const authority = new ExecutionAuthority(ctx, this.artifacts, this.eventLog, this.options.runtimeGateway);
      const dispatcher = this.buildDispatcher(authority);
      const result = await dispatcher.dispatch(validatedIntent);
      record.result = result;
      await this.saveRun(record);

      if (!result.ok) {
        await transition('failed');
        await this.eventLog.append(validatedIntent.runId, { type: 'run_failed', reason: result.error ?? 'intent execution failed' });
        return record;
      }

      if (validatedIntent.type !== 'edit_files') {
        await transition('completed');
        await this.eventLog.append(validatedIntent.runId, { type: 'run_completed', mode: 'read_only' });
        return record;
      }

      const patchArtifactId = result.artifactIds?.[0];
      const patchArtifact = patchArtifactId ? await this.artifacts.findById(validatedIntent.runId, patchArtifactId) : null;
      if (!patchArtifact) {
        await transition('failed');
        await this.eventLog.append(validatedIntent.runId, { type: 'run_failed', reason: 'missing patch artifact after edit_files proposal' });
        return record;
      }

      record.patchArtifactId = patchArtifact.id;
      await this.saveRun(record);
      await transition('proposed');
      await transition('awaiting_approval');

      const validation = await this.promotionGate.evaluate({
        runId: validatedIntent.runId,
        worktreeDir,
        patchArtifact,
        artifacts: this.artifacts,
        eventLog: this.eventLog,
        actor: this.options.actor,
        requestedBy: validatedIntent.requestedBy,
        validationOverride: validatedIntent.validationOverride,
      });
      record.validation = validation;
      const reviewBundle = await this.writeReviewBundle({
        intent: validatedIntent,
        patchArtifactRecord: patchArtifact,
        validation,
      });
      record.reviewBundleArtifactId = reviewBundle.id;
      await this.saveRun(record);
      await this.eventLog.append(validatedIntent.runId, {
        type: 'promotion_evaluated',
        ok: validation.ok,
        requiresApproval: validation.requiresApproval,
        results: validation.results,
        summary: validation.summary,
        overrideApplied: validation.overrideApplied,
        overrideReason: validation.overrideReason,
        executedValidatorCount: validation.executedValidatorCount,
      });

      if (!validation.ok) {
        const failureReason = validation.results.find((result) => !result.ok)?.summary ?? validation.summary;
        await transition('failed');
        await this.eventLog.append(validatedIntent.runId, { type: 'run_failed', reason: failureReason });
        return record;
      }

      await transition('validated');
      return record;
    });
  }

  async approve(runId: string, approvalDecision: { actor: string; reason?: string }): Promise<RunRecord> {
    return this.withRunLock(runId, async () => {
      const record = await this.getRun(runId);
      if (!record) throw new RunNotFoundError(runId);

      const state = new RunStateMachine(record.state);
      if (state.current === 'approved' || state.current === 'applied' || state.current === 'completed') {
        throw new RunConflictError('duplicate_approval', `run ${runId} already approved`);
      }
      if (state.current === 'rejected') {
        throw new RunConflictError('approval_already_rejected', `run ${runId} has already been rejected`);
      }
      if (state.current !== 'validated' && state.current !== 'awaiting_approval') {
        throw new RunConflictError('approval_not_pending', `run ${runId} is not awaiting approval`);
      }

      const from = state.current;
      if (state.current === 'awaiting_approval') {
        state.transitionOrThrow('validated');
      }
      state.transitionOrThrow('approved');
      record.state = state.current;
      record.approval = { approved: true, actor: approvalDecision.actor, at: new Date().toISOString(), reason: approvalDecision.reason };
      await this.saveRun(record);
      await this.eventLog.append(runId, { type: 'approval_recorded', approved: true, actor: approvalDecision.actor, reason: approvalDecision.reason });
      await this.eventLog.append(runId, { type: 'state_transition', from, to: 'approved' });
      return record;
    });
  }

  async reject(runId: string, decision: { actor: string; reason?: string }): Promise<RunRecord> {
    return this.withRunLock(runId, async () => {
      const record = await this.getRun(runId);
      if (!record) throw new RunNotFoundError(runId);

      const state = new RunStateMachine(record.state);
      if (state.current === 'rejected') {
        throw new RunConflictError('duplicate_rejection', `run ${runId} already rejected`);
      }
      if (state.current === 'approved' || state.current === 'applied' || state.current === 'completed') {
        throw new RunConflictError('rejection_not_pending', `run ${runId} can no longer be rejected`);
      }
      if (state.current !== 'validated' && state.current !== 'awaiting_approval') {
        throw new RunConflictError('rejection_not_pending', `run ${runId} is not awaiting approval`);
      }

      const from = state.current;
      if (state.current === 'awaiting_approval') {
        state.transitionOrThrow('validated');
      }
      state.transitionOrThrow('rejected');
      record.state = state.current;
      record.approval = { approved: false, actor: decision.actor, at: new Date().toISOString(), reason: decision.reason };
      await this.saveRun(record);
      await this.eventLog.append(runId, { type: 'approval_recorded', approved: false, actor: decision.actor, reason: decision.reason });
      await this.eventLog.append(runId, { type: 'state_transition', from, to: 'rejected' });
      return record;
    });
  }

  async applyApproved(runId: string): Promise<RunRecord> {
    return this.withRunLock(runId, async () => {
      const record = await this.getRun(runId);
      if (!record) throw new RunNotFoundError(runId);
      if (record.state === 'applied' || record.state === 'completed') {
        throw new RunConflictError('duplicate_apply', `run ${runId} patch already applied`);
      }
      if (record.state !== 'approved') {
        throw new RunConflictError('apply_requires_approved_run', `run ${runId} is not approved`);
      }
      if (!record.patchArtifactId) {
        throw new RunConflictError('missing_patch_artifact', `run ${runId} has no patch artifact`);
      }

      const artifact = await this.artifacts.findById(runId, record.patchArtifactId);
      if (!artifact) {
        throw new RunConflictError('missing_patch_artifact', `patch artifact not found: ${record.patchArtifactId}`);
      }
      const patch = JSON.parse(await this.artifacts.read(artifact)) as PatchArtifact;
      await this.eventLog.append(runId, { type: 'artifact_apply_requested', artifactId: artifact.id, actor: this.options.actor });
      await applyPatchArtifact({ artifact: patch, worktreeDir: this.worktreeFor(runId), actor: this.options.actor, eventLog: this.eventLog });

      const state = new RunStateMachine(record.state);
      const from = state.current;
      state.transitionOrThrow('applied');
      record.state = state.current;
      await this.saveRun(record);
      await this.eventLog.append(runId, { type: 'state_transition', from, to: 'applied' });
      return record;
    });
  }

  async completeApplied(runId: string, notes?: string): Promise<RunRecord> {
    return this.withRunLock(runId, async () => {
      const record = await this.getRun(runId);
      if (!record) throw new RunNotFoundError(runId);
      if (record.state === 'completed') {
        throw new RunConflictError('duplicate_completion', `run ${runId} already completed`);
      }
      if (record.state !== 'applied') {
        throw new RunConflictError('complete_requires_applied_run', `run ${runId} is not applied`);
      }

      const state = new RunStateMachine(record.state);
      const from = state.current;
      state.transitionOrThrow('completed');
      record.state = state.current;

      const events = await this.eventLog.readAll(runId);
      const replay = replayRun(events);
      const summary = buildRunSummary({
        runId,
        finalState: record.state,
        validation: record.validation,
        approval: record.approval,
        appliedArtifactIds: record.patchArtifactId ? [record.patchArtifactId] : [],
        reviewArtifactIds: record.reviewBundleArtifactId ? [record.reviewBundleArtifactId] : [],
        commandCount: events.filter((event) => event.type === 'command_executed').length,
        modelCallCount: events.filter((event) => event.type === 'model_called').length,
        timings: { startedAt: record.startedAt, completedAt: new Date().toISOString() },
        notes: notes ?? `replay outcome=${replay.outcome} state=${replay.currentState}`,
      });
      await this.artifacts.writeJson(runId, 'summary', summary, { finalState: record.state });
      await this.saveRun(record);
      await this.eventLog.append(runId, { type: 'state_transition', from, to: 'completed' });
      await this.eventLog.append(runId, { type: 'run_completed', notes });
      return record;
    });
  }

  async run(intent: Intent): Promise<RunRecord> {
    return this.startRun(intent);
  }
}
