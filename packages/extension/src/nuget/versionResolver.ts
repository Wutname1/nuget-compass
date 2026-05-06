import type { AvailableVersion, FilterState } from '@nuget-compass/shared';
import { searchPackageVersions } from '../dotnet/packageSearch.js';
import { NuGetCatalogClient } from './catalogClient.js';
import { isVersionCompatibleWithProject } from './tfmCompat.js';
import { compareVersions, isPrerelease, parseVersion } from '../semver/parse.js';
import { passesUpdateLevel } from '../semver/filter.js';

export interface ResolveOptions {
  packageId: string;
  currentVersion: string;
  projectTargetFrameworks: string[];
  cwd: string;
  filters: FilterState;
  catalog: NuGetCatalogClient;
  /** Cap on how many versions to enrich with catalog data per call. */
  maxVersionsToEnrich?: number;
}

const DEFAULT_MAX_VERSIONS = 40;

/**
 * Enumerate all versions of a package, enrich the most relevant ones with
 * catalog metadata (target framework support), and return them filtered and
 * sorted newest-first.
 *
 * "Most relevant" = the latest N versions that pass the update-level rule,
 * plus the current version. Older versions are returned bare (no TFM data),
 * which the UI can show in an "older versions" tail behind a click.
 */
export async function resolveAvailableVersions(
  options: ResolveOptions,
): Promise<{
  versions: AvailableVersion[];
  newestAllowed?: string;
}> {
  const allRaw = await searchPackageVersions(options.packageId, options.cwd);
  const current = parseVersion(options.currentVersion);

  const parsed = allRaw
    .map((raw) => ({ raw, parsed: parseVersion(raw) }))
    .filter((x): x is { raw: string; parsed: NonNullable<ReturnType<typeof parseVersion>> } =>
      Boolean(x.parsed),
    )
    .sort((a, b) => compareVersions(b.parsed, a.parsed));

  // Determine which versions are "in scope for filtering": versions that, if
  // compatible, would be offered as updates. We enrich those with catalog
  // metadata since the user will be looking at them.
  const inScope: typeof parsed = [];
  if (current) {
    for (const entry of parsed) {
      if (
        passesUpdateLevel(entry.parsed, {
          current,
          level: options.filters.updateLevel,
          includePrerelease: options.filters.includePrerelease,
        })
      ) {
        inScope.push(entry);
      }
      if (inScope.length >= (options.maxVersionsToEnrich ?? DEFAULT_MAX_VERSIONS)) break;
    }
  }

  const enriched = await options.catalog.getManyVersionMetadata(
    options.packageId,
    inScope.map((v) => v.raw),
  );
  const enrichedByVersion = new Map(enriched.map((m) => [m.version, m]));

  const versions: AvailableVersion[] = parsed.map(({ raw, parsed: p }) => {
    const meta = enrichedByVersion.get(raw);
    const supportedFrameworks = meta?.supportedFrameworks ?? [];
    const isCompatible =
      meta === undefined
        ? true // unknown - don't claim incompatible
        : isVersionCompatibleWithProject(options.projectTargetFrameworks, supportedFrameworks);
    return {
      version: raw,
      published: meta?.published,
      supportedFrameworks,
      isCompatible,
      isPrerelease: isPrerelease(p),
    };
  });

  const newestAllowed = current
    ? findNewestAllowed(versions, current.raw, options)
    : undefined;

  return { versions, newestAllowed };
}

function findNewestAllowed(
  versions: AvailableVersion[],
  currentRaw: string,
  options: ResolveOptions,
): string | undefined {
  const current = parseVersion(currentRaw);
  if (!current) return undefined;

  // versions is already sorted newest-first.
  for (const v of versions) {
    const parsed = parseVersion(v.version);
    if (!parsed) continue;
    if (
      !passesUpdateLevel(parsed, {
        current,
        level: options.filters.updateLevel,
        includePrerelease: options.filters.includePrerelease,
      })
    ) {
      continue;
    }
    if (options.filters.tfm === 'compatible' && !v.isCompatible) continue;
    return v.version;
  }
  return undefined;
}
