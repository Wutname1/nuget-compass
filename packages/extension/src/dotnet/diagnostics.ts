import type { DotnetProblem } from './packageList.js';

export type DiagnosticLevel = 'error' | 'warning' | 'info';

/**
 * Structured NuGet diagnostic distilled from raw `dotnet` output and from the
 * .NET 10 `problems[]` array. Each well-known NU-code parses into the same
 * shape so the UI can group, dedupe, and offer fixes uniformly.
 */
export interface NuDiagnostic {
  /** Stable identifier for dedupe + suppression. */
  key: string;
  code: string;
  level: DiagnosticLevel;
  /** Absolute project path the diagnostic applies to. May be empty for solution-scoped problems. */
  projectPath: string;
  packageId?: string;
  /** Version we observed (NU1605: the lower/requested version; NU1902: the installed version). */
  fromVersion?: string;
  /** Version required to satisfy a constraint (NU1605: the higher version). */
  toVersion?: string;
  /** Target framework mentioned by the diagnostic, when relevant (NU1701). */
  targetFramework?: string;
  /** URL for advisory pages (NU1902). */
  url?: string;
  /** Severity word from the diagnostic, e.g. "moderate" / "high" (NU1902). */
  severity?: string;
  message: string;
  /** Suggested resolution. UI shows a single button per fix. */
  fix?: NuFix;
}

export type NuFix =
  | { kind: 'pin-package'; projectPath: string; packageId: string; version: string; reason: string }
  | { kind: 'remove-package'; projectPath: string; packageId: string; reason: string }
  | { kind: 'update-package'; projectPath: string; packageId: string; reason: string }
  | { kind: 'reveal-package'; projectPath: string; packageId: string };

const NU_CODE_RE = /\b(NU\d{4})\b/;

/**
 * Parse a chunk of raw `dotnet` output (stdout+stderr, possibly multi-project)
 * for well-known NU-code lines. Continuation lines starting with whitespace
 * are folded into the preceding diagnostic's message so we don't emit a fake
 * record for each dependency-graph hint.
 */
export function parseDiagnosticsFromOutput(
  projectPath: string,
  output: string,
): NuDiagnostic[] {
  if (!output || output.trim().length === 0) return [];
  const out: NuDiagnostic[] = [];
  const lines = output.split(/\r?\n/);
  let current: NuDiagnostic | undefined;

  for (const rawLine of lines) {
    // Continuation: leading whitespace and we have an open diagnostic — fold in.
    if (current && /^\s+\S/.test(rawLine)) {
      current.message = `${current.message}\n${rawLine.trim()}`;
      continue;
    }

    const codeMatch = NU_CODE_RE.exec(rawLine);
    if (!codeMatch) {
      // Non-NU line: close any open record.
      if (current) {
        out.push(current);
        current = undefined;
      }
      continue;
    }
    if (current) {
      out.push(current);
      current = undefined;
    }
    const level: DiagnosticLevel = /\berror\b/i.test(rawLine)
      ? 'error'
      : /\bwarning\b/i.test(rawLine)
        ? 'warning'
        : 'info';

    // Pull the project path prefix when it's the host's "<csproj> : error/warning NUxxxx: ..." form.
    // Matches drive-qualified Windows paths, POSIX absolute paths, or a bare
    // project-file name (handy in tests and relative-cwd invocations).
    const projectPrefix =
      /^(?:\s*)([A-Za-z]:\\[^:]+\.\w+proj|\/[^:]+\.\w+proj|\S+\.\w+proj)\s*:/.exec(rawLine);
    const projForLine = projectPrefix?.[1] ?? projectPath;

    const text = rawLine.replace(/^.*?\bNU\d{4}\s*:\s*/, '').trim();
    current = buildDiagnostic(codeMatch[1] ?? 'NU0000', level, projForLine, text);
  }
  if (current) out.push(current);
  return out;
}

/** Parse the .NET 10 `problems[]` array into structured diagnostics. */
export function parseDiagnosticsFromProblems(
  fallbackProjectPath: string,
  problems: DotnetProblem[] | undefined,
): NuDiagnostic[] {
  if (!problems || problems.length === 0) return [];
  const out: NuDiagnostic[] = [];
  for (const p of problems) {
    const text = (p.text ?? '').trim();
    if (text.length === 0) continue;
    const codeMatch = NU_CODE_RE.exec(text);
    const code = codeMatch?.[1] ?? 'NU0000';
    const level: DiagnosticLevel =
      p.level === 'error' ? 'error' : p.level === 'warning' ? 'warning' : 'info';
    const stripped = text.replace(/^.*?\bNU\d{4}\s*:\s*/, '').trim();
    out.push(buildDiagnostic(code, level, p.project ?? fallbackProjectPath, stripped));
  }
  return out;
}

/**
 * Deduplicate diagnostics across projects. NU1605 in particular is reported
 * once per project in the dependency graph that observes the downgrade —
 * collapse those to a single record keyed by (code, packageId, fromVersion,
 * toVersion). For everything else, key on (code, packageId, projectPath).
 */
export function dedupeDiagnostics(items: NuDiagnostic[]): NuDiagnostic[] {
  const byKey = new Map<string, NuDiagnostic>();
  for (const d of items) {
    const existing = byKey.get(d.key);
    if (!existing) {
      byKey.set(d.key, d);
      continue;
    }
    // Prefer the entry with a fix; otherwise keep the first.
    if (!existing.fix && d.fix) byKey.set(d.key, d);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
    return a.code.localeCompare(b.code) || (a.packageId ?? '').localeCompare(b.packageId ?? '');
  });
}

function buildDiagnostic(
  code: string,
  level: DiagnosticLevel,
  projectPath: string,
  text: string,
): NuDiagnostic {
  switch (code) {
    case 'NU1605':
      return buildNU1605(level, projectPath, text);
    case 'NU1510':
      return buildNU1510(level, projectPath, text);
    case 'NU1701':
      return buildNU1701(level, projectPath, text);
    case 'NU1902':
    case 'NU1903':
    case 'NU1904':
      return buildNU1902(code, level, projectPath, text);
    default:
      return {
        key: `${code}|${projectPath}|${text.slice(0, 80)}`,
        code,
        level,
        projectPath,
        message: text,
      };
  }
}

// "Warning As Error: Detected package downgrade: <id> from X.Y.Z to A.B.C. Reference the package directly ..."
const NU1605_RE =
  /Detected package downgrade:\s*([A-Za-z0-9_.-]+)\s+from\s+([0-9][\w\-+]*(?:\.[0-9][\w\-+]*)*)\s+to\s+([0-9][\w\-+]*(?:\.[0-9][\w\-+]*)*)/i;

function buildNU1605(level: DiagnosticLevel, projectPath: string, text: string): NuDiagnostic {
  const m = NU1605_RE.exec(text);
  if (!m) {
    return {
      key: `NU1605|${projectPath}|${text.slice(0, 80)}`,
      code: 'NU1605',
      level,
      projectPath,
      message: text,
    };
  }
  const [, packageId, fromVersion, toVersion] = m;
  return {
    // Dedupe across the cascade of dep-chain lines that all reference the same downgrade.
    key: `NU1605|${packageId}|${fromVersion}|${toVersion}|${projectPath}`,
    code: 'NU1605',
    level,
    projectPath,
    packageId,
    fromVersion,
    toVersion,
    message: text,
    fix: packageId && fromVersion
      ? {
          kind: 'pin-package',
          projectPath,
          packageId,
          version: fromVersion,
          reason: `Pin ${packageId} to ${fromVersion} directly in this project so NuGet stops trying to downgrade it.`,
        }
      : undefined,
  };
}

// "PackageReference System.Net.Http will not be pruned. Consider removing this package..."
const NU1510_RE = /PackageReference\s+([A-Za-z0-9_.-]+)\s+will not be pruned/i;

function buildNU1510(level: DiagnosticLevel, projectPath: string, text: string): NuDiagnostic {
  const m = NU1510_RE.exec(text);
  const packageId = m?.[1];
  return {
    key: `NU1510|${packageId ?? ''}|${projectPath}`,
    code: 'NU1510',
    level,
    projectPath,
    packageId,
    message: text,
    fix: packageId
      ? {
          kind: 'remove-package',
          projectPath,
          packageId,
          reason: `${packageId} is already provided by the .NET SDK for this target framework. Removing the explicit reference avoids version-conflict surprises.`,
        }
      : undefined,
  };
}

// "Package 'MsGraphConsumer 1.0.30' was restored using '.NETFramework,Version=v4.6.1, ...' instead of the project target framework 'net10.0'."
const NU1701_RE =
  /Package\s+'([A-Za-z0-9_.-]+)\s+([0-9][\w\-+]*(?:\.[0-9][\w\-+]*)*)'\s+was restored using\s+'[^']*'\s+instead of the project target framework\s+'([^']+)'/i;

function buildNU1701(level: DiagnosticLevel, projectPath: string, text: string): NuDiagnostic {
  const m = NU1701_RE.exec(text);
  return {
    key: `NU1701|${m?.[1] ?? ''}|${m?.[2] ?? ''}|${m?.[3] ?? ''}`,
    code: 'NU1701',
    level,
    projectPath,
    packageId: m?.[1],
    fromVersion: m?.[2],
    targetFramework: m?.[3],
    message: text,
    fix: m?.[1]
      ? {
          kind: 'reveal-package',
          projectPath,
          packageId: m[1],
        }
      : undefined,
  };
}

// "Package 'HtmlSanitizer' 8.0.838 has a known moderate severity vulnerability, https://github.com/..."
const NU1902_RE =
  /Package\s+'([A-Za-z0-9_.-]+)'\s+([0-9][\w\-+]*(?:\.[0-9][\w\-+]*)*)\s+has a known\s+([A-Za-z]+)\s+severity vulnerability,?\s*(\S+)?/i;

function buildNU1902(
  code: string,
  level: DiagnosticLevel,
  projectPath: string,
  text: string,
): NuDiagnostic {
  const m = NU1902_RE.exec(text);
  const packageId = m?.[1];
  return {
    key: `${code}|${packageId ?? ''}|${m?.[2] ?? ''}`,
    code,
    level,
    projectPath,
    packageId,
    fromVersion: m?.[2],
    severity: m?.[3]?.toLowerCase(),
    url: m?.[4],
    message: text,
    fix: packageId
      ? {
          kind: 'update-package',
          projectPath,
          packageId,
          reason: `${packageId} ${m?.[2] ?? ''} has a known ${m?.[3] ?? ''} severity vulnerability. Update to a fixed version.`,
        }
      : undefined,
  };
}
