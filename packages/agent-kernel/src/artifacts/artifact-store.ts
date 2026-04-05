import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { RunCorruptionError } from '../errors/run-errors.js';

export type ArtifactKind = 'patch' | 'command-output' | 'model-output' | 'summary' | 'validator-report' | 'approval-decision' | 'review-bundle';

export type ArtifactRecord = {
  id: string;
  kind: ArtifactKind;
  runId: string;
  path: string;
  sha256: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export class ArtifactStore {
  constructor(private readonly baseDir: string) {}

  private root(runId: string): string {
    return join(this.baseDir, 'storage', 'runs', runId, 'artifacts');
  }

  private manifestPath(runId: string): string {
    return join(this.root(runId), 'manifest.jsonl');
  }

  async write(runId: string, kind: ArtifactKind, payload: string, metadata?: Record<string, unknown>, extension = 'json'): Promise<ArtifactRecord> {
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const id = createHash('sha256').update(kind).update(':').update(sha256).digest('hex');
    const fileName = `${kind}-${id.slice(0, 16)}.${extension}`;
    const path = join(this.root(runId), fileName);
    const record: ArtifactRecord = {
      id,
      kind,
      runId,
      path,
      sha256,
      createdAt: new Date().toISOString(),
      metadata,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, payload, 'utf8');
    await appendFile(this.manifestPath(runId), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async writeJson(runId: string, kind: ArtifactKind, data: unknown, metadata?: Record<string, unknown>): Promise<ArtifactRecord> {
    return this.write(runId, kind, JSON.stringify(data, null, 2), metadata, 'json');
  }

  async read(record: ArtifactRecord): Promise<string> {
    return readFile(record.path, 'utf8');
  }

  async list(runId: string): Promise<ArtifactRecord[]> {
    try {
      const raw = await readFile(this.manifestPath(runId), 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line) as ArtifactRecord;
          } catch {
            throw new RunCorruptionError('artifact_manifest_corrupt', `corrupt artifact manifest for run ${runId} at line ${index + 1}`);
          }
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async findById(runId: string, id: string): Promise<ArtifactRecord | null> {
    const entries = await this.list(runId);
    return entries.find((entry) => entry.id === id) ?? null;
  }
}
