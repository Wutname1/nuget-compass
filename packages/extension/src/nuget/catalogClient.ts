import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../logging/logger.js';

/**
 * Subset of the NuGet v3 registration page that we actually consume.
 */
interface RegistrationPage {
  catalogEntry: string;
}

/**
 * Subset of the catalog entry. dependencyGroups[].targetFramework is the
 * one piece of data the SDK doesn't give us.
 */
interface CatalogEntry {
  id: string;
  version: string;
  /** ISO-8601 publish date. Sometimes absent on very old packages. */
  published?: string;
  listed?: boolean;
  dependencyGroups?: Array<{
    targetFramework?: string;
    dependencies?: Array<{ id: string; range?: string }>;
  }>;
}

export interface PackageVersionMetadata {
  id: string;
  version: string;
  published?: string;
  listed: boolean;
  /** TFMs declared in dependencyGroups; empty array if data missing. */
  supportedFrameworks: string[];
}

export interface CatalogClientOptions {
  /** Path under which to cache catalog responses. */
  cacheDir: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Maximum concurrent in-flight requests. */
  maxConcurrent?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENT = 8;

export class NuGetCatalogClient {
  private readonly cacheDir: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly memCache = new Map<string, PackageVersionMetadata>();

  constructor(options: CatalogClientOptions) {
    this.cacheDir = options.cacheDir;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  /**
   * Fetch metadata for a single (id, version). Cached aggressively because the
   * catalog data for an immutable version never changes.
   */
  async getVersionMetadata(id: string, version: string): Promise<PackageVersionMetadata> {
    const key = cacheKey(id, version);
    const cached = this.memCache.get(key);
    if (cached) return cached;

    const onDisk = await this.readDiskCache(key);
    if (onDisk) {
      this.memCache.set(key, onDisk);
      return onDisk;
    }

    const fetched = await this.fetchVersion(id, version);
    this.memCache.set(key, fetched);
    await this.writeDiskCache(key, fetched).catch((err: unknown) => {
      logger.warn(`catalog cache write failed for ${key}: ${(err as Error).message}`);
    });
    return fetched;
  }

  /**
   * Resolve metadata for many versions in parallel, capped at maxConcurrent.
   * Versions that fail are returned with empty supportedFrameworks so the UI
   * can surface a "no data" badge instead of hiding the version entirely.
   */
  async getManyVersionMetadata(
    id: string,
    versions: readonly string[],
  ): Promise<PackageVersionMetadata[]> {
    return Promise.all(
      versions.map(async (v) => {
        try {
          return await this.getVersionMetadata(id, v);
        } catch (err) {
          logger.warn(`catalog fetch failed for ${id}@${v}: ${(err as Error).message}`);
          return {
            id,
            version: v,
            listed: true,
            supportedFrameworks: [],
          };
        }
      }),
    );
  }

  private async fetchVersion(id: string, version: string): Promise<PackageVersionMetadata> {
    const lowerId = id.toLowerCase();
    const registrationUrl = `https://api.nuget.org/v3/registration5-semver1/${encodeURIComponent(lowerId)}/${encodeURIComponent(version)}.json`;

    const reg = await this.fetchJson<RegistrationPage>(registrationUrl);
    const catalog = await this.fetchJson<CatalogEntry>(reg.catalogEntry);

    const supportedFrameworks = (catalog.dependencyGroups ?? [])
      .map((g) => g.targetFramework)
      .filter((tfm): tfm is string => typeof tfm === 'string' && tfm.length > 0);

    return {
      id: catalog.id,
      version: catalog.version,
      published: catalog.published,
      listed: catalog.listed ?? true,
      supportedFrameworks,
    };
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

  private async readDiskCache(key: string): Promise<PackageVersionMetadata | undefined> {
    try {
      const file = path.join(this.cacheDir, shardOf(key), `${key}.json`);
      const data = await fs.readFile(file, 'utf8');
      return JSON.parse(data) as PackageVersionMetadata;
    } catch {
      return undefined;
    }
  }

  private async writeDiskCache(key: string, data: PackageVersionMetadata): Promise<void> {
    const dir = path.join(this.cacheDir, shardOf(key));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(data), 'utf8');
  }
}

function cacheKey(id: string, version: string): string {
  // Filesystem-safe; ids and versions are well-bounded already, but be defensive.
  return `${id.toLowerCase()}@${version.toLowerCase()}`.replace(/[^a-z0-9._@-]/g, '_');
}

function shardOf(key: string): string {
  // Shard by first character to keep any one directory bounded.
  const ch = key.charAt(0);
  return /[a-z0-9]/.test(ch) ? ch : '_';
}

/**
 * Build a client that caches under the extension's globalStorageUri.
 */
export function createCatalogClient(context: vscode.ExtensionContext): NuGetCatalogClient {
  const cfg = vscode.workspace.getConfiguration('nuget-compass');
  return new NuGetCatalogClient({
    cacheDir: path.join(context.globalStorageUri.fsPath, 'catalog-cache'),
    timeoutMs: cfg.get<number>('requestTimeoutMs') ?? DEFAULT_TIMEOUT_MS,
    maxConcurrent: cfg.get<number>('maxConcurrentCatalogRequests') ?? DEFAULT_MAX_CONCURRENT,
  });
}
