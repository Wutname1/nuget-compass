import type { AggregatedPackage, PackageInstall } from '../state/aggregate.js';
import type { DeprecationInfo, VulnerabilityInfo } from '@nuget-compass/shared';

/** Small inline badges for an aggregated (consolidated) package row. */
export function PackageRowBadges({ pkg }: { pkg: AggregatedPackage }): JSX.Element | null {
  const has =
    pkg.hasVulnerability || pkg.isDeprecated || pkg.isTransitive || pkg.isDivergent;
  if (!has) return null;
  return (
    <>
      {pkg.hasVulnerability ? (
        <span
          className={`badge badge-vuln${
            pkg.highestVulnSeverity ? ` badge-vuln-${pkg.highestVulnSeverity.toLowerCase()}` : ''
          }`}
          title={collectVulnTitle(pkg.installs)}
        >
          ⚠ {pkg.highestVulnSeverity ?? 'vulnerable'}
        </span>
      ) : null}
      {pkg.isDeprecated ? (
        <span
          className="badge badge-deprecated"
          title={collectDeprecationTitle(pkg.installs)}
        >
          🪦 deprecated
        </span>
      ) : null}
      {pkg.isTransitive ? (
        <span className="badge badge-trans">transitive</span>
      ) : null}
      {pkg.isDivergent ? (
        <span
          className="pkg-divergent-warn"
          title={`Installed at ${pkg.versions.length} different versions: ${pkg.versions.join(
            ', ',
          )}`}
        >
          ⚠ {pkg.versions.length} versions
        </span>
      ) : null}
    </>
  );
}

/** Single-install badge cluster (used in the by-project list). */
export function InstallBadges({ install }: { install: PackageInstall }): JSX.Element | null {
  const hasVuln = install.vulnerability && install.vulnerability.length > 0;
  if (!hasVuln && !install.deprecation && !install.isTransitive) return null;
  const sev = hasVuln ? highestSeverity(install.vulnerability!) : undefined;
  return (
    <>
      {hasVuln ? (
        <span
          className={`badge badge-vuln badge-vuln-${sev!.toLowerCase()}`}
          title={install
            .vulnerability!.map((v) => `${v.severity}: ${v.advisoryUrl}`)
            .join('\n')}
        >
          ⚠ {sev}
        </span>
      ) : null}
      {install.deprecation ? (
        <span
          className="badge badge-deprecated"
          title={describeDeprecation(install.deprecation)}
        >
          🪦 deprecated
        </span>
      ) : null}
      {install.isTransitive ? (
        <span className="badge badge-trans">transitive</span>
      ) : null}
    </>
  );
}

function collectVulnTitle(installs: PackageInstall[]): string {
  const lines: string[] = [];
  for (const i of installs) {
    if (!i.vulnerability) continue;
    for (const v of i.vulnerability) {
      lines.push(`${i.projectName}: ${v.severity} — ${v.advisoryUrl}`);
    }
  }
  return lines.join('\n');
}

function collectDeprecationTitle(installs: PackageInstall[]): string {
  const lines: string[] = [];
  for (const i of installs) {
    if (!i.deprecation) continue;
    lines.push(`${i.projectName}: ${describeDeprecation(i.deprecation)}`);
  }
  return lines.join('\n');
}

function describeDeprecation(dep: DeprecationInfo): string {
  return [
    dep.reasons.join(', '),
    dep.message ?? '',
    dep.alternatePackage
      ? `Use ${dep.alternatePackage.id} ${dep.alternatePackage.versionRange}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function highestSeverity(vulns: VulnerabilityInfo[]): VulnerabilityInfo['severity'] {
  const order: VulnerabilityInfo['severity'][] = ['Low', 'Moderate', 'High', 'Critical'];
  let best: VulnerabilityInfo['severity'] = 'Low';
  for (const v of vulns) {
    if (order.indexOf(v.severity) > order.indexOf(best)) best = v.severity;
  }
  return best;
}
