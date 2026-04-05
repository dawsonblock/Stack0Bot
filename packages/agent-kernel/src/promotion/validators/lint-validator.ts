import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ValidationContext } from '../promotion-gate.js';
import { ExecutableValidator, type ExecutableValidationSelection } from '../executable-validator.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(rootDir: string): Promise<{ scripts?: Record<string, string> } | null> {
  const packageJsonPath = join(rootDir, 'package.json');
  if (!(await exists(packageJsonPath))) {
    return null;
  }

  return JSON.parse(await readFile(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> };
}

export class LintValidator extends ExecutableValidator {
  readonly name = 'lint-validator';

  protected async selectCommand(ctx: ValidationContext): Promise<ExecutableValidationSelection> {
    const rootDir = ctx.stagedWorktreeDir ?? ctx.worktreeDir;
    const packageJson = await readPackageJson(rootDir);
    const lintScripts = ['lint', 'format:check', 'check:format'];

    if (packageJson) {
      const lintScript = lintScripts.find((scriptName) => packageJson.scripts?.[scriptName]?.trim());
      if (lintScript) {
        return {
          kind: 'command',
          detectedBy: `package.json:scripts.${lintScript}`,
          summary: `executed package.json ${lintScript} script`,
          command: {
            command: { command: 'npm', args: ['run', lintScript] },
            source: `package.json#scripts.${lintScript}`,
            timeoutMs: 120_000,
          },
        };
      }
    }

    const candidateCommands: Array<{
      file: string;
      command: { command: string; args: string[] };
      source: string;
    }> = [
      {
        file: 'eslint.config.js',
        command: { command: 'npx', args: ['--no-install', 'eslint', '.'] },
        source: 'eslint.config.js',
      },
      {
        file: '.eslintrc',
        command: { command: 'npx', args: ['--no-install', 'eslint', '.'] },
        source: '.eslintrc',
      },
      {
        file: '.eslintrc.json',
        command: { command: 'npx', args: ['--no-install', 'eslint', '.'] },
        source: '.eslintrc.json',
      },
      {
        file: 'biome.json',
        command: { command: 'npx', args: ['--no-install', 'biome', 'check', '.'] },
        source: 'biome.json',
      },
      {
        file: 'ruff.toml',
        command: { command: 'python3', args: ['-m', 'ruff', 'check', '.'] },
        source: 'ruff.toml',
      },
      {
        file: 'Cargo.toml',
        command: { command: 'cargo', args: ['fmt', '--check'] },
        source: 'Cargo.toml',
      },
    ];

    for (const candidate of candidateCommands) {
      if (await exists(join(rootDir, candidate.file))) {
        return {
          kind: 'command',
          detectedBy: candidate.file,
          summary: `executed lint or format check for ${candidate.file}`,
          command: {
            command: candidate.command,
            source: candidate.source,
            timeoutMs: 120_000,
          },
        };
      }
    }

    const pyprojectPath = join(rootDir, 'pyproject.toml');
    if (await exists(pyprojectPath)) {
      const pyproject = await readFile(pyprojectPath, 'utf8');
      if (pyproject.includes('[tool.ruff')) {
        return {
          kind: 'command',
          detectedBy: 'pyproject.toml:[tool.ruff]',
          summary: 'executed ruff check from pyproject configuration',
          command: {
            command: { command: 'python3', args: ['-m', 'ruff', 'check', '.'] },
            source: 'pyproject.toml#[tool.ruff]',
            timeoutMs: 120_000,
          },
        };
      }
    }

    return {
      kind: 'not_applicable',
      summary: 'no lint or format configuration detected in the staged worktree',
      details: {
        reasonCode: 'no_lint_configuration',
      },
    };
  }
}
