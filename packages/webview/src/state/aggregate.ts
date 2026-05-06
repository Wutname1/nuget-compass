/**
 * Selectors that turn the per-project rows we receive from the host into the
 * consolidated by-package shape used by the new design system. Each function
 * is pure and side-effect free.
 */

import type { PackageRow, Project, VulnerabilityInfo, DeprecationInfo } from '@nuget-compass/shared';

export interface PackageInstall {
  projectPath: string;
  projectName: string;
  targetFrameworks: string[];
  resolvedVersion: string;
  newestAllowed?: string;
  isTransitive: boolean;
  vulnerability?: VulnerabilityInfo[];
  deprecation?: DeprecationInfo;
  /** Reference back to the original row (for messages that need the row). */
  row: PackageRow;
}

export interface AggregatedPackage {
  id: string;
  installs: PackageInstall[];
  /** Distinct resolved versions across installs. */
  versions: string[];
  /** True when more than one resolved version is in use across projects. */
  isDivergent: boolean;
  /** Best newer version known across installs (max of newestAllowed). */
  latestNewer?: string;
  /** True when any install has a newer version available. */
  hasUpdate: boolean;
  hasVulnerability: boolean;
  isDeprecated: boolean;
  isTransitive: boolean;
  highestVulnSeverity?: VulnerabilityInfo['severity'];
}

/**
 * Build the consolidated by-package list from the host's per-project rows.
 *
 * @param rowsByProject  rows keyed by project path
 * @param projects       project metadata for name/tfm lookup
 * @param includeTransitive  whether to include transitive dependencies
 */
export function aggregatePackages(
  rowsByProject: Record<string, PackageRow[]>,
  projects: Project[],
  includeTransitive: boolean,
): AggregatedPackage[] {
  const projectByPath = new Map(projects.map((p) => [p.path, p]));
  const map = new Map<string, AggregatedPackage>();

  for (const [projectPath, rows] of Object.entries(rowsByProject)) {
    const project = projectByPath.get(projectPath);
    if (!project) continue;
    for (const row of rows) {
      if (row.package.isTransitive && !includeTransitive) continue;
      const id = row.package.id;
      let pkg = map.get(id);
      if (!pkg) {
        pkg = {
          id,
          installs: [],
          versions: [],
          isDivergent: false,
          hasUpdate: false,
          hasVulnerability: false,
          isDeprecated: false,
          isTransitive: row.package.isTransitive,
        };
        map.set(id, pkg);
      }
      pkg.installs.push({
        projectPath,
        projectName: project.name,
        targetFrameworks: project.targetFrameworks,
        resolvedVersion: row.package.resolvedVersion,
        newestAllowed: row.newestAllowed,
        isTransitive: row.package.isTransitive,
        vulnerability: row.vulnerability,
        deprecation: row.deprecation,
        row,
      });
      // If any install is non-transitive, the package as a whole is treated as direct.
      if (!row.package.isTransitive) pkg.isTransitive = false;
    }
  }

  const arr: AggregatedPackage[] = [];
  for (const pkg of map.values()) {
    const versionSet = new Set(pkg.installs.map((i) => i.resolvedVersion));
    pkg.versions = Array.from(versionSet);
    pkg.isDivergent = versionSet.size > 1;

    const newers = pkg.installs
      .map((i) => i.newestAllowed)
      .filter((v): v is string => Boolean(v));
    pkg.latestNewer = newers.length > 0 ? maxVersion(newers) : undefined;
    pkg.hasUpdate = pkg.installs.some(
      (i) => Boolean(i.newestAllowed) && i.newestAllowed !== i.resolvedVersion,
    );
    pkg.hasVulnerability = pkg.installs.some(
      (i) => i.vulnerability && i.vulnerability.length > 0,
    );
    pkg.isDeprecated = pkg.installs.some((i) => Boolean(i.deprecation));

    const sevs: VulnerabilityInfo['severity'][] = [];
    for (const i of pkg.installs)
      if (i.vulnerability) for (const v of i.vulnerability) sevs.push(v.severity);
    pkg.highestVulnSeverity = sevs.length > 0 ? highestSeverity(sevs) : undefined;

    arr.push(pkg);
  }
  arr.sort((a, b) => a.id.localeCompare(b.id));
  return arr;
}

export type Category = 'vuln' | 'depr' | 'outdated' | 'current';

export const CATEGORY_LABEL: Record<Category, string> = {
  vuln: 'Vulnerable',
  depr: 'Deprecated',
  outdated: 'Outdated',
  current: 'Up to date',
};

export const CATEGORY_ORDER: Category[] = ['vuln', 'depr', 'outdated', 'current'];

export function categorize(pkg: AggregatedPackage): Category {
  if (pkg.hasVulnerability) return 'vuln';
  if (pkg.isDeprecated) return 'depr';
  if (pkg.hasUpdate) return 'outdated';
  return 'current';
}

function highestSeverity(
  sevs: VulnerabilityInfo['severity'][],
): VulnerabilityInfo['severity'] {
  const order: VulnerabilityInfo['severity'][] = ['Low', 'Moderate', 'High', 'Critical'];
  let best: VulnerabilityInfo['severity'] = 'Low';
  for (const s of sevs) {
    if (order.indexOf(s) > order.indexOf(best)) best = s;
  }
  return best;
}

interface ParsedVersion {
  parts: number[];
  prerelease?: string;
  raw: string;
}

function parseSemver(s: string): ParsedVersion {
  const trimmed = s.trim();
  const dashIdx = trimmed.indexOf('-');
  const main = dashIdx >= 0 ? trimmed.slice(0, dashIdx) : trimmed;
  const pre = dashIdx >= 0 ? trimmed.slice(dashIdx + 1) : undefined;
  const parts = main.split('.').map((p) => Number(p) || 0);
  return { parts, prerelease: pre, raw: trimmed };
}

function compare(a: ParsedVersion, b: ParsedVersion): number {
  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const av = a.parts[i] ?? 0;
    const bv = b.parts[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    if (a.prerelease < b.prerelease) return -1;
    if (a.prerelease > b.prerelease) return 1;
  }
  return 0;
}

function maxVersion(versions: string[]): string {
  let best = parseSemver(versions[0]!);
  for (let i = 1; i < versions.length; i++) {
    const v = parseSemver(versions[i]!);
    if (compare(v, best) > 0) best = v;
  }
  return best.raw;
}
