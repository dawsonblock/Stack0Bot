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

export class TestValidator extends ExecutableValidator {
  readonly name = 'test-validator';

  protected async selectCommand(ctx: ValidationContext): Promise<ExecutableValidationSelection> {
    const rootDir = ctx.stagedWorktreeDir ?? ctx.worktreeDir;
    const packageJson = await readPackageJson(rootDir);
    if (packageJson) {
      if (packageJson.scripts?.test?.trim()) {
        return {
          kind: 'command',
          detectedBy: 'package.json:scripts.test',
          summary: 'executed package.json test script',
          command: {
            command: { command: 'npm', args: ['test'] },
            source: 'package.json#scripts.test',
            timeoutMs: 120_000,
          },
        };
      }

      return {
        kind: 'missing_path',
        summary: 'node project detected but no bounded test command is available',
        details: {
          detectedProjectType: 'node',
          detectedBy: 'package.json',
        },
      };
    }

    if (await exists(join(rootDir, 'pyproject.toml'))) {
      return {
        kind: 'command',
        detectedBy: 'pyproject.toml',
        summary: 'executed pytest in the staged worktree',
        command: {
          command: { command: 'python3', args: ['-m', 'pytest', '-q'] },
          source: 'pyproject.toml',
          timeoutMs: 120_000,
        },
      };
    }

    if (await exists(join(rootDir, 'Cargo.toml'))) {
      return {
        kind: 'command',
        detectedBy: 'Cargo.toml',
        summary: 'executed cargo test in the staged worktree',
        command: {
          command: { command: 'cargo', args: ['test', '--quiet'] },
          source: 'Cargo.toml',
          timeoutMs: 180_000,
        },
      };
    }

    if (await exists(join(rootDir, 'go.mod'))) {
      return {
        kind: 'command',
        detectedBy: 'go.mod',
        summary: 'executed go test in the staged worktree',
        command: {
          command: { command: 'go', args: ['test', './...'] },
          source: 'go.mod',
          timeoutMs: 180_000,
        },
      };
    }

    return {
      kind: 'not_applicable',
      summary: 'no supported test project type detected in the staged worktree',
      details: {
        reasonCode: 'no_supported_project_type',
      },
    };
  }
}
