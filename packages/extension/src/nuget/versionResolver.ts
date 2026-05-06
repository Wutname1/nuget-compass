import type { AvailableVersion, FilterState } from '@nuget-compass/shared';
import { NuGetCatalogClient, type PackageVersionMetadata } from './catalogClient.js';
import { isVersionCompatibleWithProject } from './tfmCompat.js';
import { compareVersions, isPrerelease, parseVersion, type ParsedVersion } from '../semver/parse.js';
import { passesUpdateLevel } from '../semver/filter.js';

export interface ResolveOptions {
  packageId: string;
  currentVersion: string;
  projectTargetFrameworks: string[];
  filters: FilterState;
  catalog: NuGetCatalogClient;
}

export interface ResolveResult {
  versions: AvailableVersion[];
  newestAllowed?: string;
}

/**
 * Walk every published version (with TFM data) of a package, sort newest-first,
 * and surface them to the UI. Returns sorted AvailableVersion[] plus the
 * highest version that satisfies the user's filters.
 */
export async function resolveAvailableVersions(options: ResolveOptions): Promise<ResolveResult> {
  const all = await options.catalog.getPackageVersions(options.packageId);
  const sorted = sortNewestFirst(all);

  const versions: AvailableVersion[] = sorted.map((m) => ({
    version: m.version,
    published: m.published,
    supportedFrameworks: m.supportedFrameworks,
    isCompatible: m.supportedFrameworks.length === 0
      ? true
      : isVersionCompatibleWithProject(options.projectTargetFrameworks, m.supportedFrameworks),
    isPrerelease: isPrereleaseString(m.version),
    licenseExpression: m.licenseExpression,
    licenseUrl: m.licenseUrl,
    projectUrl: m.projectUrl,
    releaseNotes: m.releaseNotes,
    description: m.description,
    authors: m.authors,
    packageSize: m.packageSize,
  }));

  const newestAllowed = findNewestAllowedFromVersions(versions, options);
  return { versions, newestAllowed };
}

/**
 * Fast path used during refresh: just compute the newest version that passes
 * filters, without building the full AvailableVersion[]. Same data source,
 * same accuracy - we just don't allocate the user-facing list.
 */
export async function resolveNewestAllowed(options: ResolveOptions): Promise<string | undefined> {
  const all = await options.catalog.getPackageVersions(options.packageId);
  const current = parseVersion(options.currentVersion);
  if (!current) return undefined;

  const sorted = sortNewestFirst(all);

  for (const meta of sorted) {
    const parsed = parseVersion(meta.version);
    if (!parsed) continue;
    if (!passesUpdateLevel(parsed, {
      current,
      level: options.filters.updateLevel,
      includePrerelease: options.filters.includePrerelease,
    })) {
      continue;
    }
    if (
      options.filters.tfm === 'compatible' &&
      meta.supportedFrameworks.length > 0 &&
      !isVersionCompatibleWithProject(options.projectTargetFrameworks, meta.supportedFrameworks)
    ) {
      continue;
    }
    return meta.version;
  }
  return undefined;
}

function sortNewestFirst(metas: readonly PackageVersionMetadata[]): PackageVersionMetadata[] {
  return [...metas].sort((a, b) => {
    const pa = parseVersion(a.version);
    const pb = parseVersion(b.version);
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    return compareVersions(pb, pa);
  });
}

function findNewestAllowedFromVersions(
  versions: readonly AvailableVersion[],
  options: ResolveOptions,
): string | undefined {
  const current = parseVersion(options.currentVersion);
  if (!current) return undefined;

  for (const v of versions) {
    const parsed = parseVersion(v.version);
    if (!parsed) continue;
    if (!passesUpdateLevel(parsed, {
      current,
      level: options.filters.updateLevel,
      includePrerelease: options.filters.includePrerelease,
    })) {
      continue;
    }
    if (options.filters.tfm === 'compatible' && !v.isCompatible) continue;
    return v.version;
  }
  return undefined;
}

function isPrereleaseString(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed ? isPrerelease(parsed) : false;
}

// Re-exported so other modules can use the same parser without importing twice.
export type { ParsedVersion };
