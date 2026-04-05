import { readFile } from 'node:fs/promises';
import type { Validator, ValidationContext, ValidationResult } from '../promotion-gate.js';

const FAIL_PATTERNS = [
  '.map',
  'dangerouslyDisableSandbox',
  'process.env.OPENAI_API_KEY',
  'process.env.ANTHROPIC_API_KEY',
  'curl | bash',
  'rm -rf /',
];

const WARN_PATTERNS = [
  'TODO(security)',
  'DEBUG=',
  'console.log(',
];

export class SecurityValidator implements Validator {
  readonly name = 'security-validator';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (!ctx.patchArtifact) {
      return { name: this.name, ok: false, severity: 'fail', summary: 'missing patch artifact' };
    }
    const content = await readFile(ctx.patchArtifact.path, 'utf8');
    const failHits = FAIL_PATTERNS.filter((pattern) => content.includes(pattern));
    const warnHits = WARN_PATTERNS.filter((pattern) => content.includes(pattern));
    if (failHits.length) {
      return { name: this.name, ok: false, severity: 'fail', summary: 'security-sensitive patterns found', details: { failHits, warnHits } };
    }
    return {
      name: this.name,
      ok: true,
      severity: warnHits.length ? 'warn' : 'pass',
      summary: warnHits.length ? 'warning-level patterns found in patch artifact' : 'no suspicious patterns found in patch artifact',
      details: { warnHits },
    };
  }
}
