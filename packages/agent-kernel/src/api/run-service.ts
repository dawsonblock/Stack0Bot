
import type { Intent } from '../intents/intent.types.js';
import { RuntimeController, type RuntimeControllerOptions } from '../runtime/runtime-controller.js';

export type LocalRunApiOptions = RuntimeControllerOptions;

export class LocalRunApi {
  private readonly controller: RuntimeController;

  constructor(options: LocalRunApiOptions) {
    this.controller = new RuntimeController(options);
  }

  async createRun(intent: Intent) {
    return this.controller.startRun(intent);
  }

  async listRuns() {
    return this.controller.listRuns();
  }

  async getRun(runId: string) {
    return this.controller.getRunSnapshot(runId);
  }

  async getRunEvents(runId: string) {
    return this.controller.getEvents(runId);
  }

  async getRunArtifacts(runId: string) {
    return this.controller.getArtifacts(runId);
  }

  async approveRun(runId: string, actor: string, reason?: string) {
    return this.controller.approve(runId, { actor, reason });
  }

  async rejectRun(runId: string, actor: string, reason?: string) {
    return this.controller.reject(runId, { actor, reason });
  }

  async applyRun(runId: string) {
    return this.controller.applyApproved(runId);
  }

  async completeRun(runId: string, notes?: string) {
    return this.controller.completeApplied(runId, notes);
  }
}
