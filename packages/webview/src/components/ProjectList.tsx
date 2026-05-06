import type {
  AvailableVersion,
  DeprecationInfo,
  PackageRow,
  Project,
  VulnerabilityInfo,
} from '@nuget-compass/shared';
import { vscode } from '../vscode.js';
import {
  packageKey,
  readmeKey,
  type ProjectStatus,
  type ReadmeState,
} from '../state/reducer.js';

interface ProjectListProps {
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  projectStatus: Record<string, ProjectStatus>;
  versionsByPackage: Record<string, AvailableVersion[]>;
  readmes: Record<string, ReadmeState>;
  showTransitive: boolean;
  expanded: Record<string, true>;
  onToggleExpanded: (projectPath: string, packageId: string) => void;
}

export function ProjectList({
  projects,
  rowsByProject,
  projectStatus,
  versionsByPackage,
  readmes,
  showTransitive,
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
        const allRows = rowsByProject[p.path] ?? [];
        const topLevelRows = allRows.filter((r) => !r.package.isTransitive);
        const transitiveRows = allRows.filter((r) => r.package.isTransitive);
        const status = projectStatus[p.path];
        const summary = summarizeRows(topLevelRows);
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
              projectTfms={p.targetFrameworks}
              rows={topLevelRows}
              readmes={readmes}
              versionsByPackage={versionsByPackage}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              showSkeleton={isEnriching}
            />
            {isReady && topLevelRows.length > 0 && summary.withUpdates === 0 ? (
              <p className="muted indent project-up-to-date">All top-level packages are up to date.</p>
            ) : null}
            {showTransitive && transitiveRows.length > 0 ? (
              <div className="transitive-section">
                <header className="transitive-header">
                  <span>Transitive dependencies</span>
                  <span className="muted">({transitiveRows.length})</span>
                </header>
                <PackageRows
                  projectPath={p.path}
                  projectTfms={p.targetFrameworks}
                  rows={transitiveRows}
                  readmes={readmes}
                  versionsByPackage={versionsByPackage}
                  expanded={expanded}
                  onToggleExpanded={onToggleExpanded}
                />
              </div>
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
  projectTfms: string[];
  rows: PackageRow[];
  readmes: Record<string, ReadmeState>;
  versionsByPackage: Record<string, AvailableVersion[]>;
  expanded: Record<string, true>;
  onToggleExpanded: (projectPath: string, packageId: string) => void;
  showSkeleton?: boolean;
}

function PackageRows({
  projectPath,
  projectTfms,
  rows,
  readmes,
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
                  projectTfms={projectTfms}
                  packageId={row.package.id}
                  currentVersion={row.package.resolvedVersion}
                  versions={versions}
                  readmes={readmes}
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
  projectTfms,
  packageId,
  currentVersion,
  versions,
  readmes,
}: {
  projectPath: string;
  projectTfms: string[];
  packageId: string;
  currentVersion: string;
  versions: AvailableVersion[] | undefined;
  readmes: Record<string, ReadmeState>;
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
      {list.map((v) => (
        <VersionRow
          key={v.version}
          v={v}
          projectPath={projectPath}
          projectTfms={projectTfms}
          packageId={packageId}
          currentVersion={currentVersion}
          readmes={readmes}
        />
      ))}
    </ul>
  );
}

function VersionRow({
  v,
  projectPath,
  projectTfms,
  packageId,
  currentVersion,
  readmes,
}: {
  v: AvailableVersion;
  projectPath: string;
  projectTfms: string[];
  packageId: string;
  currentVersion: string;
  readmes: Record<string, ReadmeState>;
}): JSX.Element {
  const isCurrent = v.version === currentVersion;
  const clickable = !isCurrent;
  const className =
    'version-string ' +
    (isCurrent ? 'version-current' : '') +
    (!v.isCompatible ? ' version-incompatible' : '');

  const hasExtra =
    Boolean(v.description) || Boolean(v.releaseNotes) || Boolean(v.readmeUrl);
  const readme = v.readmeUrl ? readmes[readmeKey(packageId, v.version)] : undefined;

  return (
    <li className="version-row-wrapper">
      <div className="version-row">
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
              ✗ Requires {renderTfms(v.supportedFrameworks, projectTfms)}
            </span>
          ) : null}
          {v.isCompatible && v.supportedFrameworks.length > 0 ? (
            <span className="muted version-tfms">
              {renderTfms(v.supportedFrameworks, projectTfms)}
            </span>
          ) : null}
          {v.licenseExpression ? (
            <a
              className="version-license"
              href={v.licenseUrl ?? '#'}
              title={v.licenseUrl ?? v.licenseExpression}
              target="_blank"
              rel="noopener noreferrer"
            >
              {v.licenseExpression}
            </a>
          ) : null}
          {v.packageSize !== undefined ? (
            <span className="muted version-size" title="Package size on disk">
              {formatBytes(v.packageSize)}
            </span>
          ) : null}
          {v.published ? (
            <span className="muted version-date">{formatDate(v.published)}</span>
          ) : null}
          {hasExtra ? (
            <details
              className="version-details"
              onToggle={(e) => {
                const isOpen = (e.target as HTMLDetailsElement).open;
                if (isOpen && v.readmeUrl && !readme) {
                  vscode.postMessage({
                    type: 'view:fetchReadme',
                    packageId,
                    version: v.version,
                    readmeUrl: v.readmeUrl,
                  });
                }
              }}
            >
              <summary>details</summary>
              <VersionDetails v={v} readme={readme} />
            </details>
          ) : null}
        </span>
      </div>
    </li>
  );
}

function VersionDetails({
  v,
  readme,
}: {
  v: AvailableVersion;
  readme: ReadmeState | undefined;
}): JSX.Element {
  return (
    <div className="version-details-body">
      {v.description ? (
        <section>
          <h5>Description</h5>
          <p>{v.description}</p>
        </section>
      ) : null}
      {v.releaseNotes ? (
        <section>
          <h5>Release notes</h5>
          <pre className="release-notes">{v.releaseNotes}</pre>
        </section>
      ) : null}
      {v.readmeUrl ? (
        <section>
          <h5>README</h5>
          {readme === undefined ? (
            <p className="muted">Click "details" again to load.</p>
          ) : readme.loading ? (
            <p className="muted">Loading…</p>
          ) : readme.contentType === 'error' ? (
            <p className="muted">Could not load README ({readme.errorMessage ?? 'unknown error'}).</p>
          ) : (
            <pre className="readme-body">{readme.body}</pre>
          )}
          {v.readmeUrl ? (
            <a href={v.readmeUrl} target="_blank" rel="noopener noreferrer" className="muted">
              Open on nuget.org
            </a>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Render the supported-framework list with the project's matching framework
 * bolded so the user can see which TFM they're consuming.
 */
function renderTfms(supported: string[], projectTfms: string[]): JSX.Element {
  return (
    <>
      {supported.map((tfm, i) => {
        const matches = projectTfms.some((p) => normalize(p) === normalize(tfm));
        return (
          <span key={tfm}>
            {i > 0 ? ', ' : ''}
            {matches ? <strong className="tfm-match">{tfm}</strong> : <span>{tfm}</span>}
          </span>
        );
      })}
    </>
  );
}

function normalize(tfm: string): string {
  // Trim whitespace and lowercase; strip the ".NET" prefix variants and
  // canonicalize "version=v" syntax.
  return tfm
    .toLowerCase()
    .replace(/^\.net(framework|standard|coreapp|),?\s*(?:version=v?)?/i, (match) => {
      if (match.startsWith('.netframework')) return 'net';
      if (match.startsWith('.netstandard')) return 'netstandard';
      if (match.startsWith('.netcoreapp')) return 'netcoreapp';
      return 'net';
    })
    .replace(/\s+/g, '');
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}


function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
