import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RunCorruptionError } from '../errors/run-errors.js';
import type { AgentEvent, AgentEventType } from './event-types.js';

export const EVENT_SCHEMA_VERSION = 1 as const;

export class EventLog {
  constructor(private readonly baseDir: string) {}

  pathFor(runId: string): string {
    return join(this.baseDir, 'storage', 'runs', runId, 'events.jsonl');
  }

  async appendTyped(event: Omit<AgentEvent, 'timestamp' | 'schemaVersion'>): Promise<AgentEvent> {
    const record = {
      ...event,
      timestamp: new Date().toISOString(),
      schemaVersion: EVENT_SCHEMA_VERSION,
    } as AgentEvent;
    const path = this.pathFor(record.runId);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async append(runId: string, event: Omit<AgentEvent, 'runId' | 'timestamp' | 'schemaVersion'>): Promise<AgentEvent> {
    return this.appendTyped({ ...event, runId });
  }

  async readAll(runId: string): Promise<AgentEvent[]> {
    try {
      const raw = await readFile(this.pathFor(runId), 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line) as AgentEvent;
          } catch {
            throw new RunCorruptionError('event_log_corrupt', `corrupt event log for run ${runId} at line ${index + 1}`);
          }
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async readByType(runId: string, type: AgentEventType): Promise<AgentEvent[]> {
    const events = await this.readAll(runId);
    return events.filter((event) => event.type === type);
  }
}
