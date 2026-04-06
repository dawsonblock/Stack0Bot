import { readFile } from 'node:fs/promises';
import { validatePatchArtifact, type PatchArtifact } from '../../artifacts/patch-artifact.js';
import type { Validator, ValidationContext, ValidationResult } from '../promotion-gate.js';

type SecurityFinding = {
  ruleId: string;
  severity: 'warn' | 'fail';
  file: string;
  rationale: string;
  source: 'added_line' | 'path';
  line?: number;
  excerpt?: string;
  heuristic: true;
};

type PathRule = {
  ruleId: string;
  severity: 'warn';
  rationale: string;
  pattern: RegExp;
};

type LineRule = {
  ruleId: string;
  severity: 'warn' | 'fail';
  rationale: string;
  pattern: RegExp;
};

const BLOCKING_LINE_RULES: LineRule[] = [
  {
    ruleId: 'HEURISTIC_BLOCKED_DOWNLOAD_EXECUTE',
    severity: 'fail',
    rationale: 'added line downloads and immediately executes remote content',
    pattern: /\b(curl|wget)\b[^|\n]*\|\s*(bash|sh|zsh|powershell|pwsh)\b/i,
  },
  {
    ruleId: 'HEURISTIC_BLOCKED_DESTRUCTIVE_SHELL',
    severity: 'fail',
    rationale: 'added line includes an obviously destructive shell or permission pattern',
    pattern: /\brm\s+-rf\s+\/(?:\s|$)|\bchmod\s+777\b|\bmkfs\b|\bdd\s+if=.*\sof=\/dev\//i,
  },
  {
    ruleId: 'HEURISTIC_BLOCKED_SANDBOX_BYPASS',
    severity: 'fail',
    rationale: 'added line appears to disable or bypass sandbox controls',
    pattern: /dangerouslyDisableSandbox|disable(?:d)?Sandbox|sandbox.*bypass/i,
  },
];

const WARNING_LINE_RULES: LineRule[] = [
  {
    ruleId: 'HEURISTIC_WARN_SUBPROCESS',
    severity: 'warn',
    rationale: 'added line introduces subprocess execution and should be reviewed manually',
    pattern: /\b(execSync|execFileSync|execFile|exec|spawnSync|spawn|subprocess\.run|os\.system|ProcessBuilder)\b/,
  },
  {
    ruleId: 'HEURISTIC_WARN_NETWORK',
    severity: 'warn',
    rationale: 'added line introduces direct network access and should be reviewed manually',
    pattern: /\b(fetch\(|axios\.|requests\.(get|post|put|delete)\(|http\.request\(|https\.request\(|urllib\.request|socket\.)/,
  },
  {
    ruleId: 'HEURISTIC_WARN_DEBUG_MARKER',
    severity: 'warn',
    rationale: 'added line includes a debug or manual-security marker',
    pattern: /TODO\(security\)|console\.log\(|DEBUG=/,
  },
  {
    ruleId: 'HEURISTIC_WARN_PERMISSION_CHANGE',
    severity: 'warn',
    rationale: 'added line changes permissions or ownership and should be reviewed manually',
    pattern: /\b(chmod\(|chmod\s+|chown\(|chown\s+)/,
  },
];

const RISKY_PATH_RULES: PathRule[] = [
  {
    ruleId: 'HEURISTIC_WARN_RISKY_ENV_TARGET',
    severity: 'warn',
    rationale: 'patch touches an environment or credential-adjacent file target',
    pattern: /(^|\/)(\.env(\.|$)|\.npmrc$|\.pypirc$)/i,
  },
  {
    ruleId: 'HEURISTIC_WARN_RISKY_SHELL_INIT_TARGET',
    severity: 'warn',
    rationale: 'patch touches a shell init target that can change interactive execution behavior',
    pattern: /(^|\/)(\.bashrc$|\.zshrc$|\.profile$|\.bash_profile$)/i,
  },
  {
    ruleId: 'HEURISTIC_WARN_RISKY_CI_TARGET',
    severity: 'warn',
    rationale: 'patch touches CI or automation workflow configuration',
    pattern: /(^|\/)\.github\/workflows\/.*\.ya?ml$/i,
  },
  {
    ruleId: 'HEURISTIC_WARN_RISKY_DEPLOY_TARGET',
    severity: 'warn',
    rationale: 'patch touches a deploy, release, or publish script target',
    pattern: /(^|\/)(scripts\/.*(deploy|release|publish)|.*(deploy|release|publish).*(\.sh|\.ya?ml|\.json|\.ts|\.js))$/i,
  },
  {
    ruleId: 'HEURISTIC_WARN_RISKY_AUTH_TARGET',
    severity: 'warn',
    rationale: 'patch touches auth, oauth, token, credential, or permission-related code',
    pattern: /(auth|oauth|token|credential|permission)/i,
  },
];

const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(['"])([^'"\\]{8,})\2/i;
const SECRET_LITERAL_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /sk-[A-Za-z0-9]{20,}/,
];
const SECRET_PLACEHOLDER_PATTERN = /(example|sample|placeholder|changeme|replace_me|your[_-]?(token|key)|test[_-]?(token|key))/i;

function trimmedExcerpt(content: string): string {
  const normalized = content.trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function buildFinding(input: Omit<SecurityFinding, 'heuristic'>): SecurityFinding {
  return {
    ...input,
    heuristic: true,
  };
}

function findHardcodedSecret(file: string, line: number, content: string): SecurityFinding | null {
  const assignmentMatch = content.match(SECRET_ASSIGNMENT_PATTERN);
  if (assignmentMatch && !SECRET_PLACEHOLDER_PATTERN.test(assignmentMatch[3])) {
    return buildFinding({
      ruleId: 'HEURISTIC_BLOCKED_HARDCODED_SECRET',
      severity: 'fail',
      file,
      line,
      excerpt: trimmedExcerpt(content),
      source: 'added_line',
      rationale: 'added line appears to assign a literal secret or credential value',
    });
  }

  if (SECRET_LITERAL_PATTERNS.some((pattern) => pattern.test(content))) {
    return buildFinding({
      ruleId: 'HEURISTIC_BLOCKED_SECRET_PATTERN',
      severity: 'fail',
      file,
      line,
      excerpt: trimmedExcerpt(content),
      source: 'added_line',
      rationale: 'added line appears to contain a known credential token pattern',
    });
  }

  return null;
}

function scanPathRules(file: string): SecurityFinding[] {
  return RISKY_PATH_RULES
    .filter((rule) => rule.pattern.test(file))
    .map((rule) => buildFinding({
      ruleId: rule.ruleId,
      severity: rule.severity,
      file,
      source: 'path',
      rationale: rule.rationale,
    }));
}

function scanAddedLines(file: string, patch: PatchArtifact): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const addedLine of patch.lineDeltas[file]?.added ?? []) {
    const secretFinding = findHardcodedSecret(file, addedLine.line, addedLine.content);
    if (secretFinding) {
      findings.push(secretFinding);
    }
    for (const rule of [...BLOCKING_LINE_RULES, ...WARNING_LINE_RULES]) {
      if (!rule.pattern.test(addedLine.content)) {
        continue;
      }
      findings.push(buildFinding({
        ruleId: rule.ruleId,
        severity: rule.severity,
        file,
        line: addedLine.line,
        excerpt: trimmedExcerpt(addedLine.content),
        source: 'added_line',
        rationale: rule.rationale,
      }));
    }
  }
  return findings;
}

export class SecurityValidator implements Validator {
  readonly name = 'security-validator';

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

    const findings = patch.changedFiles.flatMap((file) => [
      ...scanPathRules(file),
      ...scanAddedLines(file, patch),
    ]);
    const blockingFindings = findings.filter((finding) => finding.severity === 'fail');
    const warningFindings = findings.filter((finding) => finding.severity === 'warn');
    const addedLineCount = patch.changedFiles.reduce((count, file) => count + (patch.lineDeltas[file]?.added.length ?? 0), 0);
    const removedLineCount = patch.changedFiles.reduce((count, file) => count + (patch.lineDeltas[file]?.removed.length ?? 0), 0);

    return {
      name: this.name,
      ok: blockingFindings.length === 0,
      severity: blockingFindings.length > 0 ? 'fail' : warningFindings.length > 0 ? 'warn' : 'pass',
      summary: blockingFindings.length > 0
        ? `heuristic added-line security screening found ${blockingFindings.length} blocking finding(s) and ${warningFindings.length} warning(s)`
        : warningFindings.length > 0
          ? `heuristic added-line security screening found ${warningFindings.length} warning finding(s)`
          : 'heuristic added-line security screening found no blocking or warning findings',
      details: {
        screeningMode: 'heuristic-added-line-scan',
        heuristic: true,
        limitations: [
          'heuristic only; not a full security review or policy engine',
          'blocking findings are derived from added lines and risky file targets only',
          'removed lines are tracked for review context but do not block by themselves',
        ],
        diffFormat: patch.diffFormat,
        changedFiles: patch.changedFiles,
        addedLineCount,
        removedLineCount,
        findings,
        blockingFindings,
        warningFindings,
      },
    };
  }
}
