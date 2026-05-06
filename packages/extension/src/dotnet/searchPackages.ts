import { runDotnet } from './exec.js';

/**
 * Result of `dotnet package search <query> --format json` (without --exact-match).
 * Returns the top matches per source with metadata.
 */
export interface SearchHit {
  id: string;
  /** Latest stable version per source. */
  latestVersion: string;
  totalDownloads?: number;
  owners?: string;
  description?: string;
}

export async function searchPackages(
  query: string,
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<SearchHit[]> {
  if (query.trim().length === 0) return [];
  const result = await runDotnet(
    ['package', 'search', query, '--format', 'json'],
    cwd,
    options.timeoutMs ?? 30_000,
  );
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package search exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }
  return parseSearchResults(result.stdout);
}

export function parseSearchResults(raw: string): SearchHit[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Could not parse dotnet package search output: ${(err as Error).message}`);
  }
  const sr = (parsed as { searchResult?: unknown }).searchResult;
  if (!Array.isArray(sr)) return [];

  // Dedupe by id, prefer entries from nuget.org over offline cache when both
  // appear (which is normal). The SDK orders sources offline-first; we
  // reverse so the canonical entry wins.
  const byId = new Map<string, SearchHit>();
  for (const src of [...(sr as unknown[])].reverse()) {
    if (typeof src !== 'object' || src === null) continue;
    const pkgs = (src as { packages?: unknown }).packages;
    if (!Array.isArray(pkgs)) continue;
    for (const pkg of pkgs) {
      if (typeof pkg !== 'object' || pkg === null) continue;
      const id = (pkg as { id?: unknown }).id;
      const version = (pkg as { latestVersion?: unknown; version?: unknown }).latestVersion
        ?? (pkg as { version?: unknown }).version;
      if (typeof id !== 'string' || typeof version !== 'string') continue;
      byId.set(id, {
        id,
        latestVersion: version,
        totalDownloads: typeof (pkg as Record<string, unknown>).totalDownloads === 'number'
          ? (pkg as { totalDownloads: number }).totalDownloads
          : undefined,
        owners: typeof (pkg as Record<string, unknown>).owners === 'string'
          ? (pkg as { owners: string }).owners
          : undefined,
        description: typeof (pkg as Record<string, unknown>).description === 'string'
          ? (pkg as { description: string }).description
          : undefined,
      });
    }
  }

  // Preserve the natural ordering by iterating the original (forward) list
  // and emitting on first occurrence of each id.
  const seen = new Set<string>();
  const ordered: SearchHit[] = [];
  for (const src of sr) {
    if (typeof src !== 'object' || src === null) continue;
    const pkgs = (src as { packages?: unknown }).packages;
    if (!Array.isArray(pkgs)) continue;
    for (const pkg of pkgs) {
      const id = (pkg as { id?: unknown }).id;
      if (typeof id !== 'string' || seen.has(id)) continue;
      const hit = byId.get(id);
      if (hit) {
        ordered.push(hit);
        seen.add(id);
      }
    }
  }
  return ordered;
}
