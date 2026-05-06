import type { AvailableVersion, FilterState, PackageRow, Project } from '@nuget-compass/shared';
import { vscode } from '../vscode.js';
import { readmeKey, type ReadmeState } from '../state/reducer.js';

interface DetailPanelProps {
  row: PackageRow | undefined;
  project: Project | undefined;
  filters: FilterState;
  versions: AvailableVersion[] | undefined;
  readmes: Record<string, ReadmeState>;
  onClose: () => void;
}

/**
 * Right-pane / stacked detail view. When a package row is selected, shows its
 * available versions (clickable to update), description, release notes, and
 * README. When nothing is selected, prompts the user to pick a package.
 */
export function DetailPanel({
  row,
  project,
  filters,
  versions,
  readmes,
  onClose,
}: DetailPanelProps): JSX.Element {
  if (!row || !project) {
    return (
      <div className="detail-empty">
        <p className="muted">Select a package on the left to see versions and details.</p>
      </div>
    );
  }

  return (
    <div className="detail-content">
      <header className="detail-header">
        <div className="detail-header-text">
          <h2 className="detail-title">{row.package.id}</h2>
          <p className="muted detail-subtitle">
            {project.name} · {row.package.resolvedVersion}
          </p>
        </div>
        <div className="detail-header-actions">
          {!row.package.isTransitive ? (
            <button
              type="button"
              className="package-action package-action-danger"
              title={`Uninstall ${row.package.id}`}
              onClick={() =>
                vscode.postMessage({
                  type: 'view:uninstallPackage',
                  projectPath: row.projectPath,
                  packageId: row.package.id,
                })
              }
            >
              Uninstall
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            title="Close detail panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      <DescriptionSection versions={versions} />
      <ReleaseNotesSection versions={versions} />
      <ReadmeSection
        packageId={row.package.id}
        versions={versions}
        readmes={readmes}
      />
      <VersionsSection
        row={row}
        project={project}
        filters={filters}
        versions={versions}
      />
    </div>
  );
}

function DescriptionSection({ versions }: { versions: AvailableVersion[] | undefined }): JSX.Element | null {
  const description = versions?.[0]?.description;
  if (!description) return null;
  return (
    <section className="detail-section">
      <h3>Description</h3>
      <p>{description}</p>
    </section>
  );
}

function ReleaseNotesSection({ versions }: { versions: AvailableVersion[] | undefined }): JSX.Element {
  const withNotes = (versions ?? []).filter((v) => Boolean(v.releaseNotes)).slice(0, 5);
  return (
    <section className="detail-section">
      <h3>Release notes</h3>
      {withNotes.length === 0 ? (
        <p className="muted">No release notes published.</p>
      ) : (
        <ul className="release-notes-list">
          {withNotes.map((v) => (
            <li key={v.version}>
              <strong>{v.version}</strong>
              {v.published ? <span className="muted"> · {v.published.slice(0, 10)}</span> : null}
              <pre className="release-notes">{v.releaseNotes}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReadmeSection({
  packageId,
  versions,
  readmes,
}: {
  packageId: string;
  versions: AvailableVersion[] | undefined;
  readmes: Record<string, ReadmeState>;
}): JSX.Element | null {
  // Always show the README of the latest version that has one.
  const latestWithReadme = (versions ?? []).find((v) => v.readmeUrl);
  if (!latestWithReadme) return null;
  const readme = readmes[readmeKey(packageId, latestWithReadme.version)];

  return (
    <section className="detail-section">
      <h3>
        README{' '}
        <span className="muted detail-section-meta">v{latestWithReadme.version}</span>
      </h3>
      {readme === undefined ? (
        <button
          type="button"
          className="package-action"
          onClick={() =>
            vscode.postMessage({
              type: 'view:fetchReadme',
              packageId,
              version: latestWithReadme.version,
              readmeUrl: latestWithReadme.readmeUrl!,
            })
          }
        >
          Load README
        </button>
      ) : readme.loading ? (
        <p className="muted">Loading…</p>
      ) : readme.contentType === 'error' ? (
        <p className="muted">
          Could not load README: {readme.errorMessage ?? 'unknown error'}
        </p>
      ) : (
        <pre className="readme-body">{readme.body}</pre>
      )}
      {latestWithReadme.readmeUrl ? (
        <a
          href={latestWithReadme.readmeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="muted detail-link"
        >
          Open on nuget.org
        </a>
      ) : null}
    </section>
  );
}

function VersionsSection({
  row,
  project,
  filters,
  versions,
}: {
  row: PackageRow;
  project: Project;
  filters: FilterState;
  versions: AvailableVersion[] | undefined;
}): JSX.Element {
  if (!versions) {
    return (
      <section className="detail-section">
        <h3>Versions</h3>
        <p className="muted">Loading versions…</p>
      </section>
    );
  }
  if (versions.length === 0) {
    return (
      <section className="detail-section">
        <h3>Versions</h3>
        <p className="muted">No versions found.</p>
      </section>
    );
  }

  const filtered = filterVersions(versions, row.package.resolvedVersion, filters);
  const hiddenCount = versions.length - filtered.length;

  return (
    <section className="detail-section detail-versions-section">
      <h3>
        Versions{' '}
        <span className="muted detail-section-meta">
          ({filtered.length}
          {hiddenCount > 0 ? ` shown, ${hiddenCount} hidden by filters` : ''})
        </span>
      </h3>
      {filtered.length === 0 ? (
        <p className="muted">All versions are hidden by current filters.</p>
      ) : (
        <ul className="detail-version-list">
          {filtered.map((v) => (
            <DetailVersionRow
              key={v.version}
              v={v}
              row={row}
              projectTfms={project.targetFrameworks}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Apply the active filters to the version list. The current version is always
 * included so the user has a reference point.
 */
function filterVersions(
  versions: AvailableVersion[],
  currentVersion: string,
  filters: FilterState,
): AvailableVersion[] {
  const current = parseVersion(currentVersion);
  return versions.filter((v) => {
    if (v.version === currentVersion) return true;

    if (filters.tfm === 'compatible' && !v.isCompatible) return false;
    if (!filters.includePrerelease && v.isPrerelease) return false;

    if (current) {
      const candidate = parseVersion(v.version);
      if (candidate) {
        // Allow versions older than current to remain visible (they're
        // historical context). Apply update-level only to newer versions.
        const isNewer = compareVersions(candidate, current) > 0;
        if (isNewer) {
          if (filters.updateLevel === 'patch') {
            if (candidate.major !== current.major || candidate.minor !== current.minor) {
              return false;
            }
          } else if (filters.updateLevel === 'minor') {
            if (candidate.major !== current.major) return false;
          }
        }
      }
    }
    return true;
  });
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
}

function parseVersion(s: string): ParsedVersion | undefined {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)?(?:-[\w.+-]+)?$/.exec(s.trim());
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3] ?? 0),
    prerelease: s.includes('-'),
  };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Stable > prerelease at same x.y.z
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  return 0;
}

function DetailVersionRow({
  v,
  row,
  projectTfms,
}: {
  v: AvailableVersion;
  row: PackageRow;
  projectTfms: string[];
}): JSX.Element {
  const isCurrent = v.version === row.package.resolvedVersion;
  const className =
    'version-string' +
    (isCurrent ? ' version-current' : '') +
    (!v.isCompatible ? ' version-incompatible' : '');

  const handleClick = (): void => {
    if (isCurrent) return;
    vscode.postMessage({
      type: 'view:updatePackage',
      projectPath: row.projectPath,
      packageId: row.package.id,
      toVersion: v.version,
    });
  };

  return (
    <li className="detail-version-row">
      {isCurrent ? (
        <span className={className}>
          {v.version}
          {v.isPrerelease ? <span className="badge badge-prerelease">prerelease</span> : null}
          <span className="muted"> (current)</span>
        </span>
      ) : (
        <button type="button" className={`version-button ${className}`} onClick={handleClick}>
          {v.version}
          {v.isPrerelease ? <span className="badge badge-prerelease">prerelease</span> : null}
        </button>
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
          <span className="muted version-date">{v.published.slice(0, 10)}</span>
        ) : null}
      </span>
    </li>
  );
}

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
