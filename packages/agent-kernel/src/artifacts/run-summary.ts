export type RunSummary = {
  runId: string;
  finalState: string;
  validation?: unknown;
  approval?: { approved: boolean; actor: string; at: string; reason?: string };
  appliedArtifactIds: string[];
  reviewArtifactIds: string[];
  failedReason?: string;
  commandCount: number;
  modelCallCount: number;
  timings: { startedAt: string; completedAt?: string };
  notes?: string;
};

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

export function buildRunSummary(input: RunSummary): RunSummary {
  return {
    ...input,
    appliedArtifactIds: uniqueIds(input.appliedArtifactIds),
    reviewArtifactIds: uniqueIds(input.reviewArtifactIds),
    commandCount: Math.max(0, input.commandCount),
    modelCallCount: Math.max(0, input.modelCallCount),
    failedReason: input.finalState === 'failed' ? input.failedReason : undefined,
    timings: input.timings.completedAt
      ? { startedAt: input.timings.startedAt, completedAt: input.timings.completedAt }
      : { startedAt: input.timings.startedAt },
  };
}
