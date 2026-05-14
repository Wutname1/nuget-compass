import type { InstalledPackage, Project } from '@nuget-compass/shared';
import { runDotnet } from './exec.js';

/**
 * Shape of `dotnet package list --format json` output, as of .NET SDK 9/10.
 *
 * .NET 10 added a top-level `problems` array (used for restore errors and
 * legend notes like "(A) : Auto-referenced package."). When implicit restore
 * fails, `projects` may be missing entirely and only `problems` is populated.
 *
 * Captured fixtures live in `./__fixtures__/`. If the schema changes in a
 * future SDK we'll see test failures before users do.
 */
export interface DotnetPackageListJson {
  version: number;
  parameters: string;
  projects: DotnetProjectEntry[];
  problems?: DotnetProblem[];
  sources?: string[];
}

export interface DotnetProblem {
  /** "error" | "warning" — present on .NET 10+. */
  level?: string;
  /** Project the problem applies to, when scoped. */
  project?: string;
  text: string;
}

export interface DotnetProjectEntry {
  path: string;
  /** Absent when the project is unrestored or has no PackageReferences. */
  frameworks?: DotnetFrameworkEntry[];
}

export interface DotnetFrameworkEntry {
  framework: string;
  topLevelPackages?: DotnetPackageEntry[];
  transitivePackages?: DotnetPackageEntry[];
}

export interface DotnetPackageEntry {
  id: string;
  /** Present on top-level packages; absent on transitive. */
  requestedVersion?: string;
  resolvedVersion: string;
}

export interface ListPackagesOptions {
  includeTransitive?: boolean;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
}

export interface ListPackagesRawResult {
  data: DotnetPackageListJson;
  /** Combined stdout/stderr — useful for sniffing 401/403 from feed servers. */
  output: string;
}

/**
 * Run `dotnet package list` and parse the JSON output for a given project or
 * solution path.
 */
export async function listPackages(
  projectOrSolutionPath: string,
  cwd: string,
  options: ListPackagesOptions = {},
): Promise<DotnetPackageListJson> {
  const args = buildListArgs(projectOrSolutionPath, options);

  const result = await runDotnet(args, cwd, options.timeoutMs ?? 30_000, options.extraEnv);

  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package list exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }

  return parsePackageListJson(result.stdout);
}

/** Same as listPackages but also returns the raw combined output for diagnostics. */
export async function listPackagesWithOutput(
  projectOrSolutionPath: string,
  cwd: string,
  options: ListPackagesOptions = {},
): Promise<ListPackagesRawResult> {
  const args = buildListArgs(projectOrSolutionPath, options);
  const result = await runDotnet(args, cwd, options.timeoutMs ?? 30_000, options.extraEnv);
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package list exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }
  // Lenient parse: a problems-only payload (restore failed in .NET 10) still
  // returns successfully so the caller can surface structured diagnostics
  // instead of a single opaque error string.
  return {
    data: parsePackageListJson(result.stdout, { lenient: true }),
    output: `${result.stdout}\n${result.stderr}`,
  };
}

function buildListArgs(projectOrSolutionPath: string, options: ListPackagesOptions): string[] {
  // --no-restore opts out of the .NET 10 implicit-restore behavior. Implicit
  // restore prints MSBuild output to stdout ahead of the JSON document, which
  // we have to defensively peel off in parsePackageListJson. Skipping it keeps
  // stdout clean and matches .NET 9 semantics; the workspace is expected to
  // already be restored (the user is editing it).
  const args = [
    'package',
    'list',
    '--project',
    projectOrSolutionPath,
    '--format',
    'json',
    '--no-restore',
  ];
  if (options.includeTransitive) {
    args.push('--include-transitive');
  }
  return args;
}

/**
 * Parse the JSON. Exposed for direct use against captured fixtures in tests.
 *
 * In strict mode (the default) a problems-only payload throws so callers in
 * legacy code paths still see an error. Lenient mode returns the parsed
 * object as-is so callers can extract structured diagnostics from
 * `data.problems` themselves.
 */
export function parsePackageListJson(
  raw: string,
  options: { lenient?: boolean } = {},
): DotnetPackageListJson {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('dotnet package list returned empty output');
  }

  // .NET 10's implicit restore prints MSBuild output before the JSON body.
  // Even with --no-restore we may still see a stray legend/warning line, so
  // locate the first balanced JSON object before trying to parse.
  const body = extractJsonObject(trimmed) ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(
      `Could not parse dotnet package list output as JSON: ${(err as Error).message}. ` +
        `Output starts with: ${preview(trimmed)}`,
    );
  }
  if (!isPackageListJson(parsed)) {
    const keys =
      typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).join(', ') : typeof parsed;
    const problemText = formatProblems(parsed);
    const detail = problemText ? ` Reported problems: ${problemText}.` : '';
    throw new Error(
      `dotnet package list JSON did not match expected schema (top-level keys: ${keys}).${detail} ` +
        `Output starts with: ${preview(trimmed)}`,
    );
  }
  // When restore fails in .NET 10, the JSON has `problems` but no `projects`.
  // Strict mode surfaces the problems as a real error so legacy callers see
  // them. Lenient mode returns the parsed result and lets the caller render
  // structured diagnostics from `problems[]`.
  if (
    !options.lenient &&
    parsed.projects.length === 0 &&
    parsed.problems &&
    parsed.problems.length > 0
  ) {
    const problemText = formatProblems(parsed);
    throw new Error(`dotnet package list could not produce results: ${problemText}`);
  }
  return parsed;
}

/**
 * Extract the first top-level JSON object from a string that may have
 * preamble (e.g. MSBuild restore output) before or after the JSON document.
 * Returns undefined if no balanced object is found.
 */
function extractJsonObject(s: string): string | undefined {
  const start = s.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return undefined;
}

function preview(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

function formatProblems(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) return '';
  const problems = (parsed as { problems?: unknown }).problems;
  if (!Array.isArray(problems) || problems.length === 0) return '';
  const texts: string[] = [];
  for (const p of problems) {
    if (typeof p === 'string') texts.push(p);
    else if (typeof p === 'object' && p !== null) {
      const t = (p as { text?: unknown }).text;
      if (typeof t === 'string') texts.push(t);
    }
    if (texts.length >= 3) break;
  }
  return texts.join('; ');
}

function isPackageListJson(v: unknown): v is DotnetPackageListJson {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;
  // .NET 10 may omit `projects` when restore fails and only emit `problems`.
  // Treat a missing projects field as an empty array so the caller surfaces
  // the problems via the standard error path instead of a schema mismatch.
  if (obj.projects === undefined) {
    obj.projects = [];
    return true;
  }
  return Array.isArray(obj.projects);
}

/**
 * Convert SDK output into our domain Project[]. Folds top-level and
 * (optionally) transitive packages into a single InstalledPackage[] keyed
 * by package id; multi-targeted projects collect all declared TFMs.
 */
export function projectsFromPackageListJson(
  data: DotnetPackageListJson,
  options: { includeTransitive?: boolean } = {},
): Project[] {
  return data.projects.map((entry) => projectFromEntry(entry, options));
}

function projectFromEntry(
  entry: DotnetProjectEntry,
  options: { includeTransitive?: boolean },
): Project {
  const targetFrameworks: string[] = [];
  const seenPackages = new Map<string, InstalledPackage>();

  for (const fw of entry.frameworks ?? []) {
    if (!targetFrameworks.includes(fw.framework)) {
      targetFrameworks.push(fw.framework);
    }

    for (const pkg of fw.topLevelPackages ?? []) {
      mergePackage(seenPackages, pkg, false);
    }
    if (options.includeTransitive) {
      for (const pkg of fw.transitivePackages ?? []) {
        mergePackage(seenPackages, pkg, true);
      }
    }
  }

  return {
    path: entry.path,
    name: projectName(entry.path),
    targetFrameworks,
    packages: Array.from(seenPackages.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function mergePackage(
  acc: Map<string, InstalledPackage>,
  pkg: DotnetPackageEntry,
  isTransitive: boolean,
): void {
  // If a package appears as both top-level and transitive (across multi-target
  // frameworks), top-level wins.
  const existing = acc.get(pkg.id);
  if (existing && !existing.isTransitive) {
    return;
  }
  acc.set(pkg.id, {
    id: pkg.id,
    requestedVersion: pkg.requestedVersion ?? pkg.resolvedVersion,
    resolvedVersion: pkg.resolvedVersion,
    isTransitive,
  });
}

function projectName(projectPath: string): string {
  // Take the last path segment, drop the extension. Works on / and \.
  const segments = projectPath.split(/[\\/]/);
  const file = segments[segments.length - 1] ?? projectPath;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}
