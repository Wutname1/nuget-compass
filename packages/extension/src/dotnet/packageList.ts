import type { InstalledPackage, Project } from '@nuget-compass/shared';
import { runDotnet } from './exec.js';

/**
 * Shape of `dotnet package list --format json` output, as of .NET SDK 9/10.
 *
 * Captured fixtures live in `./__fixtures__/`. If the schema changes in a
 * future SDK we'll see test failures before users do.
 */
export interface DotnetPackageListJson {
  version: number;
  parameters: string;
  projects: DotnetProjectEntry[];
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
  const args = ['package', 'list', '--project', projectOrSolutionPath, '--format', 'json'];
  if (options.includeTransitive) {
    args.push('--include-transitive');
  }

  const result = await runDotnet(args, cwd, options.timeoutMs ?? 30_000);

  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package list exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }

  return parsePackageListJson(result.stdout);
}

/**
 * Parse the JSON. Exposed for direct use against captured fixtures in tests.
 */
export function parsePackageListJson(raw: string): DotnetPackageListJson {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('dotnet package list returned empty output');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Could not parse dotnet package list output as JSON: ${(err as Error).message}`,
    );
  }
  if (!isPackageListJson(parsed)) {
    throw new Error('dotnet package list JSON did not match expected schema');
  }
  return parsed;
}

function isPackageListJson(v: unknown): v is DotnetPackageListJson {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.version === 'number' && Array.isArray(obj.projects);
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
