export type RunSummary = {
  runId: string;
  finalState: string;
  validation?: unknown;
  approval?: { approved: boolean; actor: string; at: string; reason?: string };
  appliedArtifactIds: string[];
  failedReason?: string;
  commandCount: number;
  modelCallCount: number;
  timings: { startedAt: string; completedAt?: string };
  notes?: string;
};

export function buildRunSummary(input: RunSummary): RunSummary {
  return input;
}
