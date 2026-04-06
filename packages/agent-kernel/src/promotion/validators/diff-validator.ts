import { readFile } from 'node:fs/promises';
import { validatePatchArtifact, type PatchArtifact } from '../../artifacts/patch-artifact.js';
import type { Validator, ValidationContext, ValidationResult } from '../promotion-gate.js';

const PROTECTED_PREFIXES = ['.git/', 'vendor/', 'references/'];

export class DiffValidator implements Validator {
  readonly name = 'diff-validator';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (!ctx.patchArtifact) {
      return { name: this.name, ok: false, severity: 'fail', summary: 'missing patch artifact' };
    }
    const patch = JSON.parse(await readFile(ctx.patchArtifact.path, 'utf8')) as PatchArtifact;
    try {
      validatePatchArtifact(patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { name: this.name, ok: false, severity: 'fail', summary: `invalid patch artifact: ${message}` };
    }
    if (!patch.changedFiles.length) {
      return { name: this.name, ok: false, severity: 'fail', summary: 'patch artifact has no changed files' };
    }
    for (const file of patch.changedFiles) {
      if (file.startsWith('/') || file.includes('..')) {
        return { name: this.name, ok: false, severity: 'fail', summary: `unsafe changed path: ${file}` };
      }
      if (PROTECTED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
        return { name: this.name, ok: false, severity: 'fail', summary: `protected path touched: ${file}` };
      }
      if (!patch.declaredWriteSet.includes(file)) {
        return { name: this.name, ok: false, severity: 'fail', summary: `changed path not in declared write set: ${file}` };
      }
      if (!patch.lineDeltas[file]) {
        return { name: this.name, ok: false, severity: 'fail', summary: `missing line delta metadata for changed file: ${file}` };
      }
    }
    return {
      name: this.name,
      ok: true,
      severity: 'pass',
      summary: 'patch artifact paths and declared write set are consistent',
      details: {
        changedFiles: patch.changedFiles,
        diffFormat: patch.diffFormat,
        lineDeltaFiles: Object.keys(patch.lineDeltas),
      },
    };
  }
}
