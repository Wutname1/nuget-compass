import type {
  AvailableVersion,
  DeprecationInfo,
  PackageRow,
  Project,
  VulnerabilityInfo,
} from '@nuget-compass/shared';
import { vscode } from '../vscode.js';
import { packageKey } from '../state/reducer.js';

interface ProjectListProps {
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  versionsByPackage: Record<string, AvailableVersion[]>;
  expanded: Record<string, true>;
  onToggleExpanded: (projectPath: string, packageId: string) => void;
}

export function ProjectList({
  projects,
  rowsByProject,
  versionsByPackage,
  expanded,
  onToggleExpanded,
}: ProjectListProps): JSX.Element {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p>No .NET projects found in this workspace.</p>
        <p className="muted">
          Open a folder containing a <code>.csproj</code>, <code>.fsproj</code>, or{' '}
          <code>.vbproj</code> file.
        </p>
      </div>
    );
  }

  return (
    <ul className="project-list">
      {projects.map((p) => (
        <li key={p.path} className="project-group">
          <header className="project-header">
            <span className="project-name">{p.name}</span>
            <span className="project-tfm">({p.targetFrameworks.join('; ')})</span>
          </header>
          <PackageRows
            projectPath={p.path}
            rows={rowsByProject[p.path] ?? []}
            versionsByPackage={versionsByPackage}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
          />
        </li>
      ))}
    </ul>
  );
}

interface PackageRowsProps {
  projectPath: string;
  rows: PackageRow[];
  versionsByPackage: Record<string, AvailableVersion[]>;
  expanded: Record<string, true>;
  onToggleExpanded: (projectPath: string, packageId: string) => void;
}

function PackageRows({
  projectPath,
  rows,
  versionsByPackage,
  expanded,
  onToggleExpanded,
}: PackageRowsProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="muted indent">No packages.</p>;
  }
  return (
    <ul className="package-rows">
      {rows.map((row) => {
        const key = packageKey(projectPath, row.package.id);
        const isOpen = Boolean(expanded[key]);
        const versions = versionsByPackage[key];
        return (
          <li key={row.package.id} className="package-row-wrapper">
            <button
              type="button"
              className="package-row"
              aria-expanded={isOpen}
              onClick={() => {
                onToggleExpanded(projectPath, row.package.id);
                if (!isOpen && !versions) {
                  vscode.postMessage({
                    type: 'view:expandPackage',
                    projectPath,
                    packageId: row.package.id,
                  });
                }
              }}
            >
              <span className="package-name">{row.package.id}</span>
              <span className="package-version">{row.package.resolvedVersion}</span>
              {row.newestAllowed && row.newestAllowed !== row.package.resolvedVersion ? (
                <span className="package-newer">→ {row.newestAllowed}</span>
              ) : (
                <span />
              )}
              <RowBadges vulnerability={row.vulnerability} deprecation={row.deprecation} />
            </button>
            {isOpen ? (
              <VersionList
                projectPath={projectPath}
                packageId={row.package.id}
                currentVersion={row.package.resolvedVersion}
                versions={versions}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function RowBadges({
  vulnerability,
  deprecation,
}: {
  vulnerability?: VulnerabilityInfo[];
  deprecation?: DeprecationInfo;
}): JSX.Element | null {
  const hasVuln = vulnerability && vulnerability.length > 0;
  if (!hasVuln && !deprecation) return null;

  const highest = hasVuln ? highestSeverity(vulnerability) : undefined;

  return (
    <span className="row-badges">
      {hasVuln ? (
        <span
          className={`badge badge-vuln badge-vuln-${highest!.toLowerCase()}`}
          title={vulnerability.map((v) => `${v.severity}: ${v.advisoryUrl}`).join('\n')}
        >
          ⚠ {highest}
        </span>
      ) : null}
      {deprecation ? (
        <span
          className="badge badge-deprecated"
          title={[
            `Deprecated: ${deprecation.reasons.join(', ')}`,
            deprecation.message ? `\n${deprecation.message}` : '',
            deprecation.alternatePackage
              ? `\nReplaced by: ${deprecation.alternatePackage.id} ${deprecation.alternatePackage.versionRange}`
              : '',
          ]
            .filter(Boolean)
            .join('')}
        >
          deprecated
        </span>
      ) : null}
    </span>
  );
}

function highestSeverity(vulns: VulnerabilityInfo[]): VulnerabilityInfo['severity'] {
  const order: VulnerabilityInfo['severity'][] = ['Low', 'Moderate', 'High', 'Critical'];
  let best: VulnerabilityInfo['severity'] = 'Low';
  for (const v of vulns) {
    if (order.indexOf(v.severity) > order.indexOf(best)) best = v.severity;
  }
  return best;
}

function VersionList({
  projectPath,
  packageId,
  currentVersion,
  versions,
}: {
  projectPath: string;
  packageId: string;
  currentVersion: string;
  versions: AvailableVersion[] | undefined;
}): JSX.Element {
  if (!versions) {
    return (
      <div className="version-list version-list-loading">
        <span className="muted">Loading versions…</span>
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div className="version-list">
        <span className="muted">No versions found.</span>
      </div>
    );
  }
  const top = versions.slice(0, 25);
  const includesCurrent = top.some((v) => v.version === currentVersion);
  const list =
    includesCurrent || versions.find((v) => v.version === currentVersion) === undefined
      ? top
      : [...top, versions.find((v) => v.version === currentVersion)!];

  return (
    <ul className="version-list">
      {list.map((v) => {
        const isCurrent = v.version === currentVersion;
        const clickable = !isCurrent;
        const className =
          'version-string ' +
          (isCurrent ? 'version-current' : '') +
          (!v.isCompatible ? ' version-incompatible' : '');
        return (
          <li key={v.version} className="version-row">
            {clickable ? (
              <button
                type="button"
                className={`version-button ${className}`}
                onClick={() =>
                  vscode.postMessage({
                    type: 'view:updatePackage',
                    projectPath,
                    packageId,
                    toVersion: v.version,
                  })
                }
              >
                {v.version}
                {v.isPrerelease ? <span className="badge badge-prerelease">prerelease</span> : null}
              </button>
            ) : (
              <span className={className}>
                {v.version}
                {v.isPrerelease ? <span className="badge badge-prerelease">prerelease</span> : null}
                <span className="muted"> (current)</span>
              </span>
            )}
            <span className="version-meta">
              {!v.isCompatible && v.supportedFrameworks.length > 0 ? (
                <span className="badge badge-incompatible">
                  ✗ Requires {v.supportedFrameworks.join(', ')}
                </span>
              ) : null}
              {v.isCompatible && v.supportedFrameworks.length > 0 ? (
                <span className="muted version-tfms">{v.supportedFrameworks.join(', ')}</span>
              ) : null}
              {v.published ? (
                <span className="muted version-date">{formatDate(v.published)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
