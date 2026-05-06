import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../logging/logger.js';
import {
  isRegistrationIndex,
  isRegistrationPage,
  pageCacheKey,
  type RegistrationIndex,
  type RegistrationPage,
} from './registration.js';

/**
 * One entry in the result of `getPackageVersions`. Mirrors the parts of a
 * registration leaf the rest of the codebase needs.
 */
export interface PackageVersionMetadata {
  id: string;
  version: string;
  published?: string;
  listed: boolean;
  /** TFMs declared in dependencyGroups; empty array if data is missing. */
  supportedFrameworks: string[];
}

export interface CatalogClientOptions {
  /** Path under which to cache catalog responses. Should be globalStorageUri. */
  cacheDir: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Maximum concurrent HTTP requests. */
  maxConcurrent?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENT = 8;
const REGISTRATION_BASE = 'https://api.nuget.org/v3/registration5-semver1';

/**
 * NuGet v3 registration client.
 *
 * Caching strategy:
 *  - `index.json` per package: refetched every call (small, cheap).
 *    The index lets us know which pages exist and whether the highest page
 *    has been updated since we last cached it.
 *  - Page contents per (package, lower, upper): cached on disk indefinitely.
 *    A page whose `upper` is below the latest published version is immutable
 *    (no new versions will land in its range). The page containing the
 *    current `upper` may grow; we re-fetch when its `commitTimeStamp` differs
 *    from the cached one.
 *  - In-memory hot cache for the current VS Code session, keyed by package id.
 */
export class NuGetCatalogClient {
  private readonly cacheDir: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly versionsCache = new Map<string, PackageVersionMetadata[]>();

  constructor(options: CatalogClientOptions) {
    this.cacheDir = options.cacheDir;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  /**
   * Fetch every version of a package, with target framework data inline.
   *
   * Cost on a cold cache: 1 index request + N page requests where N is the
   * number of detached pages. EF Core has 4 pages; most packages have 1-2.
   * Cost on a warm cache: 1 index request, all else served from disk.
   */
  async getPackageVersions(packageId: string): Promise<PackageVersionMetadata[]> {
    const idLower = packageId.toLowerCase();

    const memHit = this.versionsCache.get(idLower);
    if (memHit) return memHit;

    const index = await this.fetchIndex(idLower);
    const pageMetas: PackageVersionMetadata[][] = [];

    // Walk pages in parallel, capped by the concurrency gate. iterateLeaves
    // is async-iterable but we want parallel page loads; do that here directly.
    await Promise.all(
      index.items.map(async (pageRef) => {
        let leaves;
        if (Array.isArray(pageRef.items)) {
          leaves = pageRef.items;
        } else {
          const page = await this.fetchPage(idLower, pageRef);
          leaves = page.items;
        }
        pageMetas.push(leaves.map(leafToMetadata));
      }),
    );

    const flat = pageMetas.flat();
    this.versionsCache.set(idLower, flat);
    return flat;
  }

  /**
   * Lookup a single version's metadata. Backed by getPackageVersions, so the
   * cost is "fetch the whole package once" - amortized to free across multiple
   * lookups for the same package in a session.
   *
   * Kept for legacy callers; new code should prefer getPackageVersions.
   */
  async getVersionMetadata(id: string, version: string): Promise<PackageVersionMetadata> {
    const all = await this.getPackageVersions(id);
    const hit = all.find((m) => m.version.toLowerCase() === version.toLowerCase());
    if (hit) return hit;
    return {
      id,
      version,
      listed: true,
      supportedFrameworks: [],
    };
  }

  /**
   * Drop both in-memory and on-disk caches for a single package. Used by the
   * "force refresh" flow.
   */
  async invalidate(packageId: string): Promise<void> {
    const idLower = packageId.toLowerCase();
    this.versionsCache.delete(idLower);
    const dir = path.join(this.cacheDir, shardOf(idLower), idLower);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`cache invalidate failed for ${idLower}: ${describe(err)}`);
    }
  }

  // ── HTTP + cache plumbing ────────────────────────────────────────────────

  private async fetchIndex(idLower: string): Promise<RegistrationIndex> {
    const url = `${REGISTRATION_BASE}/${encodeURIComponent(idLower)}/index.json`;
    const json = await this.fetchJson<unknown>(url);
    if (!isRegistrationIndex(json)) {
      throw new Error(`Registration index at ${url} did not match expected schema`);
    }
    return json;
  }

  private async fetchPage(
    idLower: string,
    pageRef: RegistrationIndex['items'][number],
  ): Promise<RegistrationPage> {
    const cacheFile = this.pageCachePath(idLower, pageRef);
    const stamp = pageRef.commitTimeStamp;

    // Read from cache; if cached commitTimeStamp matches, return as-is.
    try {
      const cached = await fs.readFile(cacheFile, 'utf8');
      const parsed = JSON.parse(cached) as RegistrationPage & { _cachedStamp?: string };
      if (!stamp || parsed._cachedStamp === stamp) {
        return parsed;
      }
      // Stamp mismatch - the page (current/highest) has been updated. Fall through to refetch.
    } catch {
      // No cache or read error; fall through.
    }

    const json = await this.fetchJson<unknown>(pageRef['@id']);
    if (!isRegistrationPage(json)) {
      throw new Error(`Registration page at ${pageRef['@id']} did not match expected schema`);
    }
    const toWrite = { ...json, _cachedStamp: stamp };
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(toWrite), 'utf8').catch((err: unknown) => {
      logger.warn(`page cache write failed: ${describe(err)}`);
    });
    return json;
  }

  private pageCachePath(
    idLower: string,
    pageRef: RegistrationIndex['items'][number],
  ): string {
    return path.join(
      this.cacheDir,
      shardOf(idLower),
      idLower,
      `${pageCacheKey(idLower, pageRef)}.json`,
    );
  }

  private async fetchJson<T>(url: string): Promise<T> {
    await this.acquire();
    try {
      logger.trace(`HTTP GET ${url}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'nuget-compass (+vscode-extension)' },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return (await response.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** Shard the cache directory by first character so individual dirs stay bounded. */
function shardOf(key: string): string {
  const ch = key.charAt(0);
  return /[a-z0-9]/.test(ch) ? ch : '_';
}

function leafToMetadata(leaf: import('./registration.js').RegistrationLeaf): PackageVersionMetadata {
  const ce = leaf.catalogEntry;
  const supportedFrameworks = (ce.dependencyGroups ?? [])
    .map((g) => g.targetFramework)
    .filter((tfm): tfm is string => typeof tfm === 'string' && tfm.length > 0);
  return {
    id: ce.id,
    version: ce.version,
    published: ce.published,
    listed: ce.listed ?? true,
    supportedFrameworks,
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build a client backed by the user's globalStorage directory, so the cache
 * is shared across every workspace and project.
 */
export function createCatalogClient(context: vscode.ExtensionContext): NuGetCatalogClient {
  const cfg = vscode.workspace.getConfiguration('nuget-compass');
  return new NuGetCatalogClient({
    cacheDir: path.join(context.globalStorageUri.fsPath, 'catalog-cache'),
    timeoutMs: cfg.get<number>('requestTimeoutMs') ?? DEFAULT_TIMEOUT_MS,
    maxConcurrent: cfg.get<number>('maxConcurrentCatalogRequests') ?? DEFAULT_MAX_CONCURRENT,
  });
}
