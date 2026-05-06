import { runDotnet } from './exec.js';

/**
 * Shape of `dotnet package search <id> --exact-match --format json`.
 * Returns a per-source array of package matches.
 */
export interface DotnetPackageSearchJson {
  version: number;
  problems?: unknown[];
  searchResult: Array<{
    sourceName: string;
    packages: Array<{ id: string; version: string }>;
  }>;
}

export async function searchPackageVersions(
  packageId: string,
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<string[]> {
  const result = await runDotnet(
    ['package', 'search', packageId, '--exact-match', '--format', 'json'],
    cwd,
    options.timeoutMs ?? 30_000,
  );
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package search exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }
  return parseSearchVersions(result.stdout);
}

export function parseSearchVersions(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Could not parse dotnet package search output: ${(err as Error).message}`);
  }
  if (!isSearchJson(parsed)) {
    throw new Error('dotnet package search JSON did not match expected schema');
  }

  // Merge across sources (offline cache + nuget.org), dedupe, preserve order
  // by appearance.
  const seen = new Set<string>();
  const versions: string[] = [];
  for (const src of parsed.searchResult) {
    for (const pkg of src.packages) {
      if (!seen.has(pkg.version)) {
        seen.add(pkg.version);
        versions.push(pkg.version);
      }
    }
  }
  return versions;
}

function isSearchJson(v: unknown): v is DotnetPackageSearchJson {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.version === 'number' && Array.isArray(obj.searchResult);
}
