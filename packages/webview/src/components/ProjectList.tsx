import type { AvailableVersion, PackageRow, Project } from '@nuget-compass/shared';
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
            </button>
            {isOpen ? (
              <VersionList versions={versions} currentVersion={row.package.resolvedVersion} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function VersionList({
  versions,
  currentVersion,
}: {
  versions: AvailableVersion[] | undefined;
  currentVersion: string;
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
  // Show the top 25 plus "current" no matter where it falls.
  const top = versions.slice(0, 25);
  const includesCurrent = top.some((v) => v.version === currentVersion);
  const list =
    includesCurrent || versions.find((v) => v.version === currentVersion) === undefined
      ? top
      : [...top, versions.find((v) => v.version === currentVersion)!];

  return (
    <ul className="version-list">
      {list.map((v) => (
        <li key={v.version} className="version-row">
          <span
            className={
              'version-string ' +
              (v.version === currentVersion ? 'version-current' : '') +
              (!v.isCompatible ? ' version-incompatible' : '')
            }
          >
            {v.version}
            {v.isPrerelease ? <span className="badge badge-prerelease">prerelease</span> : null}
            {v.version === currentVersion ? <span className="muted"> (current)</span> : null}
          </span>
          <span className="version-meta">
            {!v.isCompatible && v.supportedFrameworks.length > 0 ? (
              <span className="badge badge-incompatible">
                ✗ Requires {v.supportedFrameworks.join(', ')}
              </span>
            ) : null}
            {v.isCompatible && v.supportedFrameworks.length > 0 ? (
              <span className="muted version-tfms">{v.supportedFrameworks.join(', ')}</span>
            ) : null}
            {v.published ? <span className="muted version-date">{formatDate(v.published)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatDate(iso: string): string {
  // YYYY-MM-DD; keep simple, no locale concerns.
  return iso.slice(0, 10);
}
