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
          title={vulnTooltip(pkg.highestVulnSeverity, pkg.installs)}
        >
          ⚠ {pkg.highestVulnSeverity ?? 'vulnerable'}
        </span>
      ) : null}
      {pkg.isDeprecated ? (
        <span
          className="badge badge-deprecated"
          title={`This package is no longer supported. Look for a replacement.\n\n${collectDeprecationTitle(pkg.installs)}`}
        >
          🪦 deprecated
        </span>
      ) : null}
      {pkg.isTransitive ? (
        <span
          className="badge badge-trans"
          title="Transitive: pulled in by another package, not added directly to your project."
        >
          transitive
        </span>
      ) : null}
      {pkg.isDivergent ? (
        <span
          className="pkg-divergent-warn"
          title={`Different versions of this package are used across projects. Pick one to keep things in sync.\n\nVersions in use: ${pkg.versions.join(
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
          title={`${severityExplanation(sev!)}\n\n${install
            .vulnerability!.map((v) => `${v.severity}: ${v.advisoryUrl}`)
            .join('\n')}`}
        >
          ⚠ {sev}
        </span>
      ) : null}
      {install.deprecation ? (
        <span
          className="badge badge-deprecated"
          title={`This package is no longer supported. Look for a replacement.\n\n${describeDeprecation(install.deprecation)}`}
        >
          🪦 deprecated
        </span>
      ) : null}
      {install.isTransitive ? (
        <span
          className="badge badge-trans"
          title="Transitive: pulled in by another package, not added directly to your project."
        >
          transitive
        </span>
      ) : null}
    </>
  );
}

function vulnTooltip(
  highest: VulnerabilityInfo['severity'] | undefined,
  installs: PackageInstall[],
): string {
  const heading = highest
    ? severityExplanation(highest)
    : 'This package has a known security problem. Update to a fixed version.';
  return `${heading}\n\n${collectVulnTitle(installs)}`;
}

function severityExplanation(sev: VulnerabilityInfo['severity']): string {
  switch (sev) {
    case 'Critical':
      return 'Critical security problem. Update right away.';
    case 'High':
      return 'High risk security problem. Plan to update soon.';
    case 'Moderate':
      return 'Moderate security problem. Update when you can.';
    case 'Low':
      return 'Low risk security problem. Update when convenient.';
    default:
      return 'This package has a known security problem.';
  }
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
