import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { ArtifactStore, type ArtifactRecord } from '../artifacts/artifact-store.js';
import type { PatchArtifact } from '../artifacts/patch-artifact.js';
import { buildReviewBundle } from '../artifacts/review-bundle.js';
import { buildRunSummary } from '../artifacts/run-summary.js';
import { applyPatchArtifact } from '../apply/apply-artifact.js';
import { EventLog } from '../events/event-log.js';
import { replayRun } from '../events/replay.js';
import { RunBadRequestError, RunConflictError, RunCorruptionError, RunNotFoundError } from '../errors/run-errors.js';
import { IntentDispatcher } from '../intents/intent-dispatcher.js';
import type { Intent, IntentResult, ExecutionContext, ValidationOverride, EditFilesIntent } from '../intents/intent.types.js';
import { validateIntent } from '../intents/intent-validator.js';
import { PromotionGate, type PromotionDecision } from '../promotion/promotion-gate.js';
import { TestValidator } from '../promotion/validators/test-validator.js';
import { LintValidator } from '../promotion/validators/lint-validator.js';
import { DiffValidator } from '../promotion/validators/diff-validator.js';
import { SecurityValidator } from '../promotion/validators/security-validator.js';
import { ExecutionAuthority, type RuntimeGatewayConfig } from './execution-authority.js';
import { selectNextAction, type RuntimeNextAction } from './next-action.js';
import { RunStateMachine, type RunState } from './state-machine.js';
import { utcNowIso } from '../time.js';

export type RuntimeControllerOptions = {
  baseDir: string;
  actor: string;
  runtimeGateway: RuntimeGatewayConfig;
};

export type RunRecord = {
  runId: string;
  state: RunState;
  nextAction?: RuntimeNextAction;
  result?: IntentResult;
  validation?: PromotionDecision;
  validationOverrideRequested?: ValidationOverride;
  patchArtifactId?: string;
  reviewBundleArtifactId?: string;
  approval?: { approved: boolean; actor: string; at: string; reason?: string };
  startedAt: string;
};

const RUN_LOCK_WAIT_MS = 30_000;
const RUN_LOCK_RETRY_MS = 100;
const RUN_LOCK_STALE_MS = 5 * 60_000;

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

  private runRoot(runId: string): string {
    return join(this.options.baseDir, 'storage', 'runs', runId);
  }

  private runLockDir(runId: string): string {
    return join(this.runRoot(runId), '.lock');
  }

  private runLockInfoPath(runId: string): string {
    return join(this.runLockDir(runId), 'owner.json');
  }

  worktreeFor(runId: string): string {
    return join(this.options.baseDir, 'workspace', `run-${runId}`);
  }

  private async readRunRecordRaw(runId: string): Promise<RunRecord | null> {
    try {
      const raw = await readFile(this.runRecordPath(runId), 'utf8');
      try {
        return JSON.parse(raw) as RunRecord;
      } catch {
        throw new RunCorruptionError('run_record_corrupt', `corrupt run record for ${runId}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async acquireFilesystemRunLock(runId: string): Promise<() => Promise<void>> {
    await mkdir(this.runRoot(runId), { recursive: true });

    const lockDir = this.runLockDir(runId);
    const lockInfoPath = this.runLockInfoPath(runId);
    const owner = {
      pid: process.pid,
      actor: this.options.actor,
      acquiredAt: utcNowIso(),
      heartbeatAt: utcNowIso(),
    };
    const deadline = Date.now() + RUN_LOCK_WAIT_MS;

    const writeOwner = async () => {
      owner.heartbeatAt = utcNowIso();
      await writeFile(lockInfoPath, JSON.stringify(owner, null, 2), 'utf8');
    };

    const isStale = async (): Promise<boolean> => {
      try {
        const lockInfo = await stat(lockInfoPath);
        return Date.now() - lockInfo.mtimeMs > RUN_LOCK_STALE_MS;
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
          const lockStats = await stat(lockDir);
          return Date.now() - lockStats.mtimeMs > RUN_LOCK_STALE_MS;
        }
        throw error;
      }
    };

    while (true) {
      try {
        await mkdir(lockDir);
        await writeOwner();
        const heartbeat = setInterval(() => {
          void writeOwner().catch(() => undefined);
        }, 1_000);
        heartbeat.unref();
        return async () => {
          clearInterval(heartbeat);
          await rm(lockDir, { recursive: true, force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') {
          throw error;
        }

        if (await isStale()) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }

        if (Date.now() >= deadline) {
          throw new RunConflictError('run_lock_timeout', `timed out waiting for run lock: ${runId}`);
        }

        await new Promise((resolve) => setTimeout(resolve, RUN_LOCK_RETRY_MS));
      }
    }
  }

  private reconcileRunRecord(runId: string, record: RunRecord | null, events: Awaited<ReturnType<EventLog['readAll']>>, artifacts: ArtifactRecord[]): RunRecord | null {
    if (!record && events.length === 0 && artifacts.length === 0) {
      return null;
    }

    const replay = replayRun(events);
    const approvalEvent = [...events].reverse().find((event) => Boolean(event) && typeof event === 'object' && !Array.isArray(event) && event.type === 'approval_recorded');
    const validationEvent = [...events].reverse().find((event) => Boolean(event) && typeof event === 'object' && !Array.isArray(event) && event.type === 'promotion_evaluated');
    const patchArtifactId = [...artifacts].reverse().find((artifact) => artifact.kind === 'patch')?.id;
    const reviewBundleArtifactId = [...artifacts].reverse().find((artifact) => artifact.kind === 'review-bundle')?.id;
    const baseRecord: RunRecord = record ?? {
      runId,
      state: replay.currentState as RunState,
      startedAt: events[0]?.timestamp ?? utcNowIso(),
    };

    return {
      ...baseRecord,
      state: replay.currentState as RunState,
      nextAction: replay.intentType
        ? selectNextAction({ currentState: replay.currentState as RunState, intentType: replay.intentType as Intent['type'] })
        : baseRecord.result?.intentType
          ? selectNextAction({ currentState: replay.currentState as RunState, intentType: baseRecord.result.intentType })
        : baseRecord.nextAction,
      patchArtifactId: patchArtifactId ?? baseRecord.patchArtifactId,
      reviewBundleArtifactId: reviewBundleArtifactId ?? baseRecord.reviewBundleArtifactId,
      approval: approvalEvent && typeof approvalEvent.approved === 'boolean'
        ? {
            approved: approvalEvent.approved,
            actor: typeof approvalEvent.actor === 'string' ? approvalEvent.actor : baseRecord.approval?.actor ?? 'unknown',
            at: approvalEvent.timestamp,
            reason: typeof approvalEvent.reason === 'string' ? approvalEvent.reason : baseRecord.approval?.reason,
          }
        : baseRecord.approval,
      validation: validationEvent
        ? {
            ok: Boolean(validationEvent.ok),
            requiresApproval: Boolean(validationEvent.requiresApproval),
            results: Array.isArray(validationEvent.results) ? validationEvent.results as PromotionDecision['results'] : [],
            summary: typeof validationEvent.summary === 'string' ? validationEvent.summary : baseRecord.validation?.summary ?? '',
            recommendedNextState: replay.validationOk ? 'validated' : 'failed',
            executedValidatorCount: typeof validationEvent.executedValidatorCount === 'number' ? validationEvent.executedValidatorCount : baseRecord.validation?.executedValidatorCount ?? 0,
            overrideApplied: Boolean(validationEvent.overrideApplied),
            overrideReason: typeof validationEvent.overrideReason === 'string' ? validationEvent.overrideReason : undefined,
          }
        : baseRecord.validation,
    };
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
    const releaseFilesystemLock = await this.acquireFilesystemRunLock(runId);
    try {
      return await work();
    } finally {
      await releaseFilesystemLock();
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

  private async updateNextAction(record: RunRecord, intentType: Intent['type']): Promise<void> {
    record.nextAction = selectNextAction({ currentState: record.state, intentType });
    await this.saveRun(record);
  }

  private async transitionRunState(args: {
    record: RunRecord;
    state: RunStateMachine;
    next: RunState;
    afterSave?: () => Promise<void>;
  }): Promise<void> {
    const from = args.state.current;
    args.state.assertTransition(args.next);
    args.record.state = args.state.current;
    await this.saveRun(args.record);
    await args.afterSave?.();
    await this.eventLog.append(args.record.runId, { type: 'state_transition', from, to: args.next });
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
    const [record, events, artifacts] = await Promise.all([
      this.readRunRecordRaw(runId),
      this.eventLog.readAll(runId),
      this.artifacts.list(runId),
    ]);
    return this.reconcileRunRecord(runId, record, events, artifacts);
  }

  async listRuns(): Promise<RunRecord[]> {
    const runsDir = join(this.options.baseDir, 'storage', 'runs');
    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const records = await Promise.all(runIds.map((runId) => this.getRun(runId)));
      return records.filter((record): record is RunRecord => Boolean(record));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return [];
      }
      throw error;
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
    const [run, events, artifacts] = await Promise.all([
      this.getRun(runId),
      this.getEvents(runId),
      this.getArtifacts(runId),
    ]);
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
    for (const intentType of ['read_file', 'search_code', 'edit_files', 'model_call', 'ask_user', 'finalize'] as const) {
      dispatcher.register(intentType, async (registeredIntent) => authority.execute(registeredIntent));
    }
    return dispatcher;
  }

  async startRun(intent: Intent): Promise<RunRecord> {
    let validatedIntent: Intent;
    try {
      validatedIntent = validateIntent(intent);
    } catch (error) {
      throw new RunBadRequestError('invalid_intent', error instanceof Error ? error.message : 'invalid intent');
    }
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
        startedAt: utcNowIso(),
      };
      await this.saveRun(record);
      await this.eventLog.append(validatedIntent.runId, { type: 'run_created', intentType: validatedIntent.type, intentId: validatedIntent.intentId });
      await this.eventLog.append(validatedIntent.runId, { type: 'intent_validated', intentId: validatedIntent.intentId, intentType: validatedIntent.type });

      const transition = async (next: RunState) => {
        await this.transitionRunState({ record, state, next });
      };

      await transition('planning');
      await transition('awaiting_action');
      await transition('executing');
      await this.eventLog.append(validatedIntent.runId, {
        type: 'execution_started',
        actor: this.options.actor,
        intentId: validatedIntent.intentId,
        intentType: validatedIntent.type,
      });

      const ctx: ExecutionContext = { runId: validatedIntent.runId, actor: this.options.actor, worktreeDir };
      const authority = new ExecutionAuthority(ctx, this.artifacts, this.eventLog, this.options.runtimeGateway);
      const dispatcher = this.buildDispatcher(authority);
      let result: IntentResult;
      try {
        result = await dispatcher.dispatch(validatedIntent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          ok: false,
          intentType: validatedIntent.type,
          error: message,
          errorDetail: {
            code: 'execution_failed',
            message,
            retriable: false,
          },
        };
      }
      record.result = result;
      await this.saveRun(record);
      await this.eventLog.append(validatedIntent.runId, {
        type: 'execution_finished',
        actor: this.options.actor,
        intentId: validatedIntent.intentId,
        intentType: validatedIntent.type,
        ok: result.ok,
        artifactIds: result.artifactIds ?? [],
        error: result.error,
        errorDetail: result.errorDetail,
      });

      if (!result.ok) {
        await transition('failed');
        await this.updateNextAction(record, validatedIntent.type);
        await this.eventLog.append(validatedIntent.runId, { type: 'run_failed', reason: result.error ?? 'intent execution failed' });
        return record;
      }

      const nextAction = selectNextAction({ currentState: state.current, intentType: validatedIntent.type });
      if (nextAction === 'complete_run') {
        await transition('completed');
        await this.updateNextAction(record, validatedIntent.type);
        await this.eventLog.append(validatedIntent.runId, { type: 'run_completed', mode: 'read_only' });
        return record;
      }
      if (validatedIntent.type !== 'edit_files') {
        throw new RunConflictError('unexpected_next_action', `unexpected next action ${nextAction} for ${validatedIntent.type}`);
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
      await this.updateNextAction(record, validatedIntent.type);
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

      if (state.current === 'awaiting_approval') {
        await this.transitionRunState({ record, state, next: 'validated' });
      }
      record.approval = { approved: true, actor: approvalDecision.actor, at: utcNowIso(), reason: approvalDecision.reason };
      await this.transitionRunState({
        record,
        state,
        next: 'approved',
        afterSave: async () => {
          await this.eventLog.append(runId, { type: 'approval_recorded', approved: true, actor: approvalDecision.actor, reason: approvalDecision.reason });
        },
      });
      await this.updateNextAction(record, record.result?.intentType ?? 'edit_files');
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

      if (state.current === 'awaiting_approval') {
        await this.transitionRunState({ record, state, next: 'validated' });
      }
      record.approval = { approved: false, actor: decision.actor, at: utcNowIso(), reason: decision.reason };
      await this.transitionRunState({
        record,
        state,
        next: 'rejected',
        afterSave: async () => {
          await this.eventLog.append(runId, { type: 'approval_recorded', approved: false, actor: decision.actor, reason: decision.reason });
        },
      });
      await this.updateNextAction(record, record.result?.intentType ?? 'edit_files');
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
      if (!record.approval?.approved) {
        throw new RunConflictError('apply_requires_approval_context', `run ${runId} is missing approved context`);
      }
      await this.eventLog.append(runId, { type: 'artifact_apply_requested', artifactId: artifact.id, actor: this.options.actor });
      await applyPatchArtifact({
        artifact: patch,
        worktreeDir: this.worktreeFor(runId),
        actor: this.options.actor,
        eventLog: this.eventLog,
        approval: record.approval,
      });

      const state = new RunStateMachine(record.state);
      await this.transitionRunState({ record, state, next: 'applied' });
      await this.updateNextAction(record, record.result?.intentType ?? 'edit_files');
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
      state.assertTransition('completed');
      record.state = state.current;

      const events = await this.eventLog.readAll(runId);
      const artifacts = await this.artifacts.list(runId);
      const replay = replayRun(events);
      const summary = buildRunSummary({
        runId,
        finalState: record.state,
        validation: record.validation,
        approval: record.approval,
        appliedArtifactIds: artifacts.filter((artifact) => artifact.kind === 'patch').map((artifact) => artifact.id),
        reviewArtifactIds: artifacts.filter((artifact) => artifact.kind === 'review-bundle').map((artifact) => artifact.id),
        commandCount: events.filter((event) => event.type === 'command_executed').length,
        modelCallCount: events.filter((event) => event.type === 'model_called').length,
        timings: { startedAt: record.startedAt, completedAt: utcNowIso() },
        notes: notes ?? `replay outcome=${replay.outcome} state=${replay.currentState}`,
      });
      await this.artifacts.writeJson(runId, 'summary', summary, { finalState: record.state });
      record.nextAction = selectNextAction({ currentState: record.state, intentType: record.result?.intentType ?? 'edit_files' });
      await this.saveRun(record);
      await this.eventLog.append(runId, { type: 'state_transition', from: 'applied', to: 'completed' });
      await this.eventLog.append(runId, { type: 'run_completed', notes });
      return record;
    });
  }

  async run(intent: Intent): Promise<RunRecord> {
    return this.startRun(intent);
  }
}
