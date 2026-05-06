import type {
  AvailableVersion,
  DeprecationInfo,
  PackageRow,
  Project,
  VulnerabilityInfo,
} from '@nuget-compass/shared';
import { vscode } from '../vscode.js';
import { packageKey, type ProjectStatus } from '../state/reducer.js';

interface ProjectListProps {
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  projectStatus: Record<string, ProjectStatus>;
  versionsByPackage: Record<string, AvailableVersion[]>;
  expanded: Record<string, true>;
  onToggleExpanded: (projectPath: string, packageId: string) => void;
}

export function ProjectList({
  projects,
  rowsByProject,
  projectStatus,
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
      {projects.map((p) => {
        const rows = rowsByProject[p.path] ?? [];
        const status = projectStatus[p.path];
        const summary = summarizeRows(rows);
        const isEnriching = status?.status === 'enriching';
        const isReady = status?.status === 'ready';
        return (
          <li key={p.path} className="project-group">
            <header className="project-header">
              <span className="project-name">{p.name}</span>
              <span className="project-tfm">({p.targetFrameworks.join('; ')})</span>
              {p.centralPackageManagement ? (
                <span
                  className="badge badge-cpm"
                  title={`Central Package Management active (${p.centralPackageManagement.propsPath})`}
                >
                  CPM
                </span>
              ) : null}
              {p.lockFilePath ? (
                <span className="badge badge-locked" title={`Locked: ${p.lockFilePath}`}>
                  locked
                </span>
              ) : null}
              {isEnriching && status.progress ? (
                <span className="project-progress">
                  {status.progress.done}/{status.progress.total} loaded
                </span>
              ) : null}
              {isReady ? <ProjectHeaderBadges summary={summary} /> : null}
              {isReady && summary.withUpdates > 0 ? (
                <button
                  type="button"
                  className="project-action"
                  title={`Update all ${summary.withUpdates} compatible package(s) in ${p.name}`}
                  onClick={() =>
                    vscode.postMessage({ type: 'view:updateAll', projectPath: p.path })
                  }
                >
                  Update All
                </button>
              ) : null}
            </header>
            <PackageRows
              projectPath={p.path}
              rows={rows}
              versionsByPackage={versionsByPackage}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              showSkeleton={isEnriching}
            />
            {isReady && rows.length > 0 && summary.withUpdates === 0 ? (
              <p className="muted indent project-up-to-date">All packages are up to date.</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface ProjectSummary {
  total: number;
  withUpdates: number;
  vulnerable: number;
  deprecated: number;
}

function summarizeRows(rows: PackageRow[]): ProjectSummary {
  let withUpdates = 0;
  let vulnerable = 0;
  let deprecated = 0;
  for (const row of rows) {
    if (row.newestAllowed && row.newestAllowed !== row.package.resolvedVersion) withUpdates++;
    if (row.vulnerability && row.vulnerability.length > 0) vulnerable++;
    if (row.deprecation) deprecated++;
  }
  return { total: rows.length, withUpdates, vulnerable, deprecated };
}

function ProjectHeaderBadges({ summary }: { summary: ProjectSummary }): JSX.Element | null {
  if (summary.total === 0) return null;
  return (
    <span className="project-header-badges">
      {summary.withUpdates > 0 ? (
        <span className="badge badge-updates">↑ {summary.withUpdates} update{summary.withUpdates === 1 ? '' : 's'}</span>
      ) : null}
      {summary.vulnerable > 0 ? (
        <span className="badge badge-vuln-summary" title={`${summary.vulnerable} vulnerable package${summary.vulnerable === 1 ? '' : 's'}`}>
          ⚠ {summary.vulnerable}
        </span>
      ) : null}
      {summary.deprecated > 0 ? (
        <span className="badge badge-deprecated-summary" title={`${summary.deprecated} deprecated package${summary.deprecated === 1 ? '' : 's'}`}>
          deprecated {summary.deprecated}
        </span>
      ) : null}
    </span>
  );
}

interface PackageRowsProps {
  projectPath: string;
  rows: PackageRow[];
  versionsByPackage: Record<string, AvailableVersion[]>;
  expanded: Record<string, true>;
  onToggleExpanded: (projectPath: string, packageId: string) => void;
  showSkeleton?: boolean;
}

function PackageRows({
  projectPath,
  rows,
  versionsByPackage,
  expanded,
  onToggleExpanded,
  showSkeleton,
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
              className={'package-row' + (row.package.isTransitive ? ' package-row-transitive' : '')}
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
              <span className="package-name">
                {row.package.id}
                {row.package.isTransitive ? (
                  <span className="badge badge-transitive">transitive</span>
                ) : null}
              </span>
              <span className="package-version">{row.package.resolvedVersion}</span>
              {row.newestAllowed && row.newestAllowed !== row.package.resolvedVersion ? (
                <span className="package-newer">→ {row.newestAllowed}</span>
              ) : showSkeleton && row.newestAllowed === undefined ? (
                <span className="package-newer-skeleton" aria-hidden="true">→ …</span>
              ) : (
                <span />
              )}
              <RowBadges vulnerability={row.vulnerability} deprecation={row.deprecation} />
            </button>
            {isOpen ? (
              <>
                <div className="package-actions">
                  <button
                    type="button"
                    className="package-action package-action-danger"
                    title={`Uninstall ${row.package.id}`}
                    onClick={() =>
                      vscode.postMessage({
                        type: 'view:uninstallPackage',
                        projectPath,
                        packageId: row.package.id,
                      })
                    }
                  >
                    Uninstall
                  </button>
                </div>
                <VersionList
                  projectPath={projectPath}
                  packageId={row.package.id}
                  currentVersion={row.package.resolvedVersion}
                  versions={versions}
                />
              </>
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
