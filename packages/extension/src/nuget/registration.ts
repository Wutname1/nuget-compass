/**
 * NuGet v3 registration index/page schema (subset).
 *
 * The registration index for a package contains a list of "pages." Each page
 * covers a contiguous range of versions, identified by `lower`/`upper`.
 *
 * For small packages (typically <=64 versions), pages have their `items[]`
 * inlined directly in the index. For large packages, the index entries omit
 * `items[]` and the `@id` URL must be fetched to load the page.
 *
 * Pages are immutable EXCEPT for the page that contains the highest version
 * of the package - that page grows as new versions are published. The
 * `commitTimeStamp` on the index and on each page changes when the page
 * is updated, which we use as a cache validator for the "current" page.
 */

export interface RegistrationIndex {
  count: number;
  items: RegistrationPageRef[];
  commitTimeStamp?: string;
  commitId?: string;
}

export interface RegistrationPageRef {
  '@id': string;
  /** Lower version bound (inclusive). */
  lower: string;
  /** Upper version bound (inclusive). */
  upper: string;
  count: number;
  /** Inline page items - present when the page is small enough to inline. */
  items?: RegistrationLeaf[];
  commitTimeStamp?: string;
  commitId?: string;
}

export interface RegistrationPage {
  '@id': string;
  count: number;
  items: RegistrationLeaf[];
  parent?: string;
  lower?: string;
  upper?: string;
  commitTimeStamp?: string;
  commitId?: string;
}

export interface RegistrationLeaf {
  '@id': string;
  catalogEntry: RegistrationCatalogEntry;
  packageContent?: string;
  commitTimeStamp?: string;
}

export interface RegistrationCatalogEntry {
  '@id': string;
  id: string;
  version: string;
  listed?: boolean;
  published?: string;
  licenseExpression?: string;
  licenseUrl?: string;
  projectUrl?: string;
  iconUrl?: string;
  readmeUrl?: string;
  /** Long-form release notes when the package author included them. */
  releaseNotes?: string;
  /** Total package size in bytes (from .nupkg metadata when present). */
  packageSize?: number;
  description?: string;
  authors?: string;
  dependencyGroups?: RegistrationDependencyGroup[];
}

export interface RegistrationDependencyGroup {
  targetFramework?: string;
  dependencies?: { id: string; range?: string }[];
}

export function isRegistrationIndex(v: unknown): v is RegistrationIndex {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.count === 'number' && Array.isArray(obj.items);
}

export function isRegistrationPage(v: unknown): v is RegistrationPage {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.count === 'number' && Array.isArray(obj.items);
}

/**
 * Walk an index/page tree and yield every catalog entry. Handles both inline
 * pages (items present on the index entry) and detached pages (items must be
 * fetched separately via the page @id).
 *
 * `loadPage` is async because detached pages live behind a HTTP fetch; we
 * keep this generator-friendly by using async iteration.
 */
export async function* iterateLeaves(
  index: RegistrationIndex,
  loadPage: (url: string) => Promise<RegistrationPage>,
): AsyncGenerator<RegistrationLeaf> {
  for (const pageRef of index.items) {
    if (Array.isArray(pageRef.items)) {
      for (const leaf of pageRef.items) yield leaf;
      continue;
    }
    const page = await loadPage(pageRef['@id']);
    for (const leaf of page.items) yield leaf;
  }
}

/**
 * For a given index entry, return a stable identifier for caching its page
 * contents. Inline pages have no separate URL, so we synthesize one from the
 * lower/upper range. Detached pages use their @id minus the host.
 */
export function pageCacheKey(packageIdLower: string, ref: RegistrationPageRef): string {
  return `${packageIdLower}__${sanitize(ref.lower)}__${sanitize(ref.upper)}`;
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, '_');
}
