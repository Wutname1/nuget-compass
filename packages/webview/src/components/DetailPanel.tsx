import { useEffect, useState } from 'react';
import type {
  AvailableVersion,
  FilterState,
  Project,
  VulnerabilityInfo,
} from '@nuget-compass/shared';
import type { AggregatedPackage, PackageInstall } from '../state/aggregate.js';
import { vscode } from '../vscode.js';
import { readmeKey, type ReadmeState, type SearchHit } from '../state/reducer.js';
import { NuGetLogo, PackageIcon } from './icons.js';

type DetailContext = 'installed' | 'browse' | 'updates';

interface InstalledSelection {
  kind: 'installed';
  pkg: AggregatedPackage;
}

interface BrowseSelection {
  kind: 'browse';
  hit: SearchHit;
}

export type DetailSelection = InstalledSelection | BrowseSelection;

interface DetailPanelProps {
  selection: DetailSelection | undefined;
  context: DetailContext;
  projects: Project[];
  /** Versions for the active aggregated package (keyed by `${projectPath}::${packageId}`). */
  versionsByPackage: Record<string, AvailableVersion[]>;
  filters: FilterState;
  readmes: Record<string, ReadmeState>;
  onClose: () => void;
  onUpdateConfirm: (req: UpdateRequest) => void;
}

export interface UpdateRequest {
  packageId: string;
  toVersion: string;
  projectPaths: string[];
}

const TABS_INSTALLED = ['Projects', 'Description', 'Release notes', 'Versions', 'README'] as const;
const TABS_BROWSE = ['Description', 'README', 'Versions', 'Add to projects'] as const;
const TABS_UPDATES = ['Projects', 'Release notes', 'Versions', 'Description'] as const;

/**
 * Brand-mark link that opens the package's nuget.org page in a new tab.
 * Sits to the left of the package name in the detail panel header.
 */
function NuGetOrgLink({ packageId }: { packageId: string }): JSX.Element {
  return (
    <a
      className="nuget-org-link"
      href={`https://www.nuget.org/packages/${encodeURIComponent(packageId)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${packageId} on nuget.org`}
      aria-label={`Open ${packageId} on nuget.org`}
    >
      <NuGetLogo size={14} color="currentColor" />
    </a>
  );
}

function tabsForContext(ctx: DetailContext): readonly string[] {
  switch (ctx) {
    case 'browse':
      return TABS_BROWSE;
    case 'updates':
      return TABS_UPDATES;
    default:
      return TABS_INSTALLED;
  }
}

export function DetailPanel(props: DetailPanelProps): JSX.Element {
  const { selection, context } = props;
  const tabs = tabsForContext(context);
  const [tab, setTab] = useState<string>(tabs[0] ?? '');

  const selectionKey =
    selection?.kind === 'installed'
      ? selection.pkg.id
      : selection?.kind === 'browse'
        ? selection.hit.id
        : '';
  useEffect(() => {
    setTab(tabs[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, context]);

  if (!selection) {
    return (
      <div className="detail-panel">
        <div className="detail-empty">
          <PackageIcon size={32} />
          <span>Select a package to view details</span>
        </div>
      </div>
    );
  }

  if (selection.kind === 'browse') {
    return <BrowseDetail {...props} hit={selection.hit} tab={tab} setTab={setTab} tabs={tabs} />;
  }

  return <InstalledDetail {...props} pkg={selection.pkg} tab={tab} setTab={setTab} tabs={tabs} />;
}

/* ─────────────────────────────────────────
   Installed detail (and Updates context)
   ───────────────────────────────────────── */

interface InstalledInnerProps extends DetailPanelProps {
  pkg: AggregatedPackage;
  tab: string;
  setTab: (t: string) => void;
  tabs: readonly string[];
}

function InstalledDetail(props: InstalledInnerProps): JSX.Element {
  const { pkg, tab, setTab, tabs, versionsByPackage, projects, filters, readmes, onClose, onUpdateConfirm } = props;

  // Use the first install's project as the source of truth for fetching versions.
  const primary = pkg.installs[0];
  const versionsKey = primary ? `${primary.projectPath}::${pkg.id}` : '';
  const versions = versionsByPackage[versionsKey];

  // Lazily request versions when the panel mounts for this package.
  useEffect(() => {
    if (!primary) return;
    if (versions) return;
    vscode.postMessage({
      type: 'view:expandPackage',
      projectPath: primary.projectPath,
      packageId: pkg.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.id, primary?.projectPath]);

  const subBits: string[] = [];
  subBits.push(`in ${pkg.installs.length} ${pkg.installs.length === 1 ? 'project' : 'projects'}`);
  if (pkg.isDivergent) subBits.push(`${pkg.versions.length} versions in use`);
  if (pkg.latestNewer) subBits.push(`latest ${pkg.latestNewer}`);

  const description = versions?.find((v) => v.description)?.description;
  const latestWithReadme = versions?.find((v) => v.readmeUrl);

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div className="detail-header-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="detail-pkg-name">
              <NuGetOrgLink packageId={pkg.id} />
              <span>{pkg.id}</span>
            </div>
            <div className="detail-pkg-sub">
              {subBits.map((b, i) => (
                <span key={i}>
                  {i > 0 ? <span className="detail-pkg-sub-sep">·</span> : null} {b}
                </span>
              ))}
            </div>
          </div>
          <div className="detail-header-actions">
            {!pkg.isTransitive ? (
              <button
                type="button"
                className="btn-secondary btn-secondary-danger"
                title={`Uninstall ${pkg.id}`}
                onClick={() => {
                  for (const inst of pkg.installs) {
                    if (inst.isTransitive) continue;
                    vscode.postMessage({
                      type: 'view:uninstallPackage',
                      projectPath: inst.projectPath,
                      packageId: pkg.id,
                    });
                  }
                }}
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
        </div>
        <div className="detail-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={'detail-tab' + (tab === t ? ' detail-tab-active' : '')}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="detail-body">
        {tab === 'Projects' ? (
          <ProjectsTab pkg={pkg} versions={versions} onUpdateConfirm={onUpdateConfirm} />
        ) : null}
        {tab === 'Description' ? (
          <DescriptionTab pkg={pkg} description={description} versions={versions} />
        ) : null}
        {tab === 'Release notes' ? <ReleaseNotesTab versions={versions} /> : null}
        {tab === 'Versions' ? (
          <VersionsTab
            pkg={pkg}
            versions={versions}
            filters={filters}
            onUpdateConfirm={onUpdateConfirm}
          />
        ) : null}
        {tab === 'README' && latestWithReadme ? (
          <ReadmeTab
            packageId={pkg.id}
            version={latestWithReadme}
            readmes={readmes}
          />
        ) : tab === 'README' ? (
          <p className="muted">No README available for this package.</p>
        ) : null}
      </div>
      {/* Suppress unused-warning for `projects`; reserved for future per-tab use. */}
      {projects.length === 0 ? null : null}
    </div>
  );
}

function ProjectsTab({
  pkg,
  versions,
  onUpdateConfirm,
}: {
  pkg: AggregatedPackage;
  versions: AvailableVersion[] | undefined;
  onUpdateConfirm: (req: UpdateRequest) => void;
}): JSX.Element {
  const initialTarget = pkg.latestNewer ?? pkg.versions[0] ?? '';
  const [target, setTarget] = useState(initialTarget);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(pkg.installs.map((i) => i.projectPath)),
  );

  function toggle(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const eligibleCount = pkg.installs.filter(
    (i) => selected.has(i.projectPath) && i.resolvedVersion !== target,
  ).length;

  function applyBulk(): void {
    if (!target) return;
    const projectPaths = pkg.installs
      .filter((i) => selected.has(i.projectPath) && i.resolvedVersion !== target)
      .map((i) => i.projectPath);
    if (projectPaths.length === 0) return;
    onUpdateConfirm({ packageId: pkg.id, toVersion: target, projectPaths });
  }

  const vulnInfo = pkg.installs.find((i) => i.vulnerability && i.vulnerability.length > 0)
    ?.vulnerability;
  const deprInfo = pkg.installs.find((i) => i.deprecation)?.deprecation;

  return (
    <div>
      {pkg.isDivergent ? (
        <div className="note-bar">
          <span aria-hidden="true">⚠</span>
          <span>
            <span className="note-bar-strong">Version drift.</span> This package is installed
            at {pkg.versions.length} different versions ({pkg.versions.join(', ')}). Set a single
            target below to align all projects.
          </span>
        </div>
      ) : null}
      {vulnInfo ? <VulnerabilityNote vuln={vulnInfo} /> : null}
      {deprInfo ? (
        <div className="note-bar note-bar-deprecated">
          <span aria-hidden="true">🪦</span>
          <span>
            <span className="note-bar-strong">Deprecated.</span>{' '}
            {deprInfo.message ?? deprInfo.reasons.join(', ')}
            {deprInfo.alternatePackage ? (
              <>
                {' '}
                Use <code>{deprInfo.alternatePackage.id}</code>{' '}
                {deprInfo.alternatePackage.versionRange}.
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="matrix">
        <div className="matrix-bulk">
          <span>Set all to</span>
          <input
            className="ver-input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            list={`${pkg.id}-versions`}
          />
          <datalist id={`${pkg.id}-versions`}>
            {(versions ?? []).map((v) => (
              <option key={v.version} value={v.version} />
            ))}
          </datalist>
          <span className="matrix-bulk-meta">
            {selected.size} of {pkg.installs.length} selected
          </span>
          <button
            type="button"
            className="matrix-bulk-apply"
            disabled={eligibleCount === 0 || !target}
            onClick={applyBulk}
          >
            Apply to {eligibleCount}
          </button>
        </div>
        <div className="matrix-head">
          <span />
          <span>Project</span>
          <span>Current</span>
          <span />
          <span className="matrix-head-action">Action</span>
        </div>
        {pkg.installs.map((inst) => (
          <ProjectsRow
            key={inst.projectPath}
            install={inst}
            packageId={pkg.id}
            target={target}
            checked={selected.has(inst.projectPath)}
            onToggle={() => toggle(inst.projectPath)}
            onUpdateConfirm={onUpdateConfirm}
          />
        ))}
      </div>
      <div className="desc-meta">
        <span className="desc-meta-label">Latest</span>
        <span className="desc-meta-value">{pkg.latestNewer ?? '—'}</span>
        <span className="desc-meta-label">Versions in use</span>
        <span className="desc-meta-value">{pkg.versions.join(', ')}</span>
      </div>
    </div>
  );
}

function ProjectsRow({
  install,
  packageId,
  target,
  checked,
  onToggle,
  onUpdateConfirm,
}: {
  install: PackageInstall;
  packageId: string;
  target: string;
  checked: boolean;
  onToggle: () => void;
  onUpdateConfirm: (req: UpdateRequest) => void;
}): JSX.Element {
  const wouldChange = target.length > 0 && install.resolvedVersion !== target;
  return (
    <div className="matrix-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Include ${install.projectName}`}
      />
      <span className="matrix-proj">
        <span>{install.projectName}</span>
        <span className="matrix-tfm">{install.targetFrameworks.join('; ')}</span>
        {install.vulnerability && install.vulnerability.length > 0 ? (
          <span className="badge badge-vuln" style={{ fontSize: 8.5 }}>
            ⚠
          </span>
        ) : null}
      </span>
      <span className="matrix-cur">{install.resolvedVersion}</span>
      <span className={'matrix-arrow' + (wouldChange ? '' : ' matrix-arrow-dim')}>
        {wouldChange ? `→ ${target}` : '—'}
      </span>
      <span className="matrix-action">
        {wouldChange ? (
          <button
            type="button"
            onClick={() =>
              onUpdateConfirm({
                packageId,
                toVersion: target,
                projectPaths: [install.projectPath],
              })
            }
          >
            Update
          </button>
        ) : (
          <span className="muted" style={{ fontSize: 10 }}>
            up to date
          </span>
        )}
      </span>
    </div>
  );
}

function VulnerabilityNote({ vuln }: { vuln: VulnerabilityInfo[] }): JSX.Element {
  const highest = highestSeverity(vuln);
  return (
    <div className="note-bar note-bar-vuln">
      <span aria-hidden="true">⚠</span>
      <span>
        <span className="note-bar-strong">{highest} severity vulnerability.</span>{' '}
        {vuln.map((v, i) => (
          <span key={i}>
            {i > 0 ? ' · ' : ''}
            <a href={v.advisoryUrl} target="_blank" rel="noopener noreferrer">
              {v.severity}
            </a>
          </span>
        ))}
      </span>
    </div>
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

function DescriptionTab({
  pkg,
  description,
  versions,
}: {
  pkg: AggregatedPackage;
  description: string | undefined;
  versions: AvailableVersion[] | undefined;
}): JSX.Element {
  const meta = versions?.[0];
  return (
    <div>
      <p className="desc-text">{description ?? `${pkg.id} — description not available yet.`}</p>
      <div className="desc-meta">
        {meta?.authors ? (
          <>
            <span className="desc-meta-label">Authors</span>
            <span className="desc-meta-value">{meta.authors}</span>
          </>
        ) : null}
        {meta?.licenseExpression ? (
          <>
            <span className="desc-meta-label">License</span>
            <span className="desc-meta-value">
              {meta.licenseUrl ? (
                <a href={meta.licenseUrl} target="_blank" rel="noopener noreferrer">
                  {meta.licenseExpression}
                </a>
              ) : (
                meta.licenseExpression
              )}
            </span>
          </>
        ) : null}
        {meta?.projectUrl ? (
          <>
            <span className="desc-meta-label">Project URL</span>
            <span className="desc-meta-value">
              <a href={meta.projectUrl} target="_blank" rel="noopener noreferrer">
                {meta.projectUrl}
              </a>
            </span>
          </>
        ) : null}
        <span className="desc-meta-label">Used by</span>
        <span className="desc-meta-value">
          {pkg.installs.map((i) => i.projectName).join(', ')}
        </span>
      </div>
    </div>
  );
}

function ReleaseNotesTab({
  versions,
}: {
  versions: AvailableVersion[] | undefined;
}): JSX.Element {
  if (!versions) return <p className="muted">Loading release notes&hellip;</p>;
  const withNotes = versions.filter((v) => Boolean(v.releaseNotes)).slice(0, 8);
  if (withNotes.length === 0) return <p className="muted">No release notes published.</p>;
  return (
    <div>
      {withNotes.map((v) => (
        <div key={v.version} className="rn-entry">
          <div className="rn-ver">
            {v.version}
            {v.published ? (
              <span className="rn-date">{v.published.slice(0, 10)}</span>
            ) : null}
          </div>
          <pre className="rn-body">{v.releaseNotes}</pre>
        </div>
      ))}
    </div>
  );
}

function VersionsTab({
  pkg,
  versions,
  filters,
  onUpdateConfirm,
}: {
  pkg: AggregatedPackage;
  versions: AvailableVersion[] | undefined;
  filters: FilterState;
  onUpdateConfirm: (req: UpdateRequest) => void;
}): JSX.Element {
  if (!versions) return <p className="muted">Loading versions&hellip;</p>;
  if (versions.length === 0) return <p className="muted">No versions found.</p>;

  const currentVersions = new Set(pkg.versions);
  const filtered = versions.filter((v) => {
    if (currentVersions.has(v.version)) return true;
    if (filters.tfm === 'compatible' && !v.isCompatible) return false;
    if (!filters.includePrerelease && v.isPrerelease) return false;
    return true;
  });

  // Use the first install's TFMs to highlight matching frameworks.
  const projectTfms = pkg.installs[0]?.targetFrameworks ?? [];

  return (
    <table className="ver-table">
      <thead>
        <tr>
          <th>Version</th>
          <th>Released</th>
          <th>Compatibility</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((v) => {
          const isCurrent = currentVersions.has(v.version);
          return (
            <tr key={v.version} className={!v.isCompatible ? 'ver-row-incompatible' : ''}>
              <td>
                <span className={'ver-row-num' + (isCurrent ? ' ver-row-num-current' : '')}>
                  {v.version}
                </span>
                {v.isPrerelease ? (
                  <span className="badge badge-prerelease" style={{ marginLeft: 6 }}>
                    🔒 prerelease
                  </span>
                ) : null}
                {isCurrent ? <span className="muted"> (current)</span> : null}
              </td>
              <td className="ver-row-date">{v.published?.slice(0, 10) ?? ''}</td>
              <td>
                {v.isCompatible ? (
                  <span style={{ color: 'var(--nc-success)' }}>
                    ✓ {renderTfms(v.supportedFrameworks, projectTfms)}
                  </span>
                ) : (
                  <span className="muted">
                    ✗ {renderTfms(v.supportedFrameworks, projectTfms)}
                  </span>
                )}
              </td>
              <td className="ver-row-action">
                {v.isCompatible && !isCurrent ? (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConfirm({
                        packageId: pkg.id,
                        toVersion: v.version,
                        projectPaths: pkg.installs.map((i) => i.projectPath),
                      })
                    }
                  >
                    Install
                  </button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function renderTfms(supported: string[], projectTfms: string[]): JSX.Element {
  if (supported.length === 0) return <span className="muted">unknown</span>;
  return (
    <>
      {supported.map((tfm, i) => {
        const matches = projectTfms.some((p) => normalize(p) === normalize(tfm));
        return (
          <span key={tfm}>
            {i > 0 ? ', ' : ''}
            {matches ? <strong className="ver-row-tfm-strong">{tfm}</strong> : <span>{tfm}</span>}
          </span>
        );
      })}
    </>
  );
}

function normalize(tfm: string): string {
  return tfm.toLowerCase().replace(/\s+/g, '');
}

function ReadmeTab({
  packageId,
  version,
  readmes,
}: {
  packageId: string;
  version: AvailableVersion;
  readmes: Record<string, ReadmeState>;
}): JSX.Element {
  const readme = readmes[readmeKey(packageId, version.version)];

  if (readme === undefined) {
    return (
      <button
        type="button"
        className="btn-secondary"
        onClick={() =>
          vscode.postMessage({
            type: 'view:fetchReadme',
            packageId,
            version: version.version,
            readmeUrl: version.readmeUrl!,
          })
        }
      >
        Load README
      </button>
    );
  }
  if (readme.loading) return <p className="muted">Loading README&hellip;</p>;
  if (readme.contentType === 'error') {
    return (
      <p className="muted">
        Could not load README: {readme.errorMessage ?? 'unknown error'}
      </p>
    );
  }
  return <pre className="readme-body">{readme.body}</pre>;
}

/* ─────────────────────────────────────────
   Browse detail (search hit)
   ───────────────────────────────────────── */

interface BrowseInnerProps extends DetailPanelProps {
  hit: SearchHit;
  tab: string;
  setTab: (t: string) => void;
  tabs: readonly string[];
}

function BrowseDetail(props: BrowseInnerProps): JSX.Element {
  const { hit, tab, setTab, tabs, projects, onClose } = props;
  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div className="detail-header-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="detail-pkg-name">
              <NuGetOrgLink packageId={hit.id} />
              <span>{hit.id}</span>
            </div>
            <div className="detail-pkg-sub">
              <span>latest {hit.latestVersion}</span>
              {hit.totalDownloads !== undefined ? (
                <>
                  <span className="detail-pkg-sub-sep">·</span>
                  <span>{formatDownloads(hit.totalDownloads)} downloads</span>
                </>
              ) : null}
              {hit.owners ? (
                <>
                  <span className="detail-pkg-sub-sep">·</span>
                  <span>by {hit.owners}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="detail-header-actions">
            <button type="button" className="icon-button" title="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="detail-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={'detail-tab' + (tab === t ? ' detail-tab-active' : '')}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="detail-body">
        {tab === 'Description' ? (
          <div>
            <p className="desc-text">{hit.description ?? 'No description available.'}</p>
            <div className="desc-meta">
              <span className="desc-meta-label">Latest</span>
              <span className="desc-meta-value">{hit.latestVersion}</span>
              {hit.owners ? (
                <>
                  <span className="desc-meta-label">Owners</span>
                  <span className="desc-meta-value">{hit.owners}</span>
                </>
              ) : null}
              {hit.totalDownloads !== undefined ? (
                <>
                  <span className="desc-meta-label">Downloads</span>
                  <span className="desc-meta-value">{formatDownloads(hit.totalDownloads)}</span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        {tab === 'README' ? (
          <p className="muted">README is fetched after installing the package.</p>
        ) : null}
        {tab === 'Versions' ? (
          <p className="muted">Browse the full version list on nuget.org.</p>
        ) : null}
        {tab === 'Add to projects' ? (
          <AddToProjectsTab packageId={hit.id} projects={projects} />
        ) : null}
      </div>
    </div>
  );
}

function AddToProjectsTab({
  packageId,
  projects,
}: {
  packageId: string;
  projects: Project[];
}): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function add(): void {
    for (const path of selected) {
      vscode.postMessage({ type: 'view:installPackage', projectPath: path, packageId });
    }
  }

  if (projects.length === 0) {
    return <p className="muted">No projects in the current workspace.</p>;
  }

  return (
    <div>
      <p className="desc-text">
        Pick projects to add <strong>{packageId}</strong> to.
      </p>
      <div className="matrix">
        <div className="matrix-head" style={{ gridTemplateColumns: '22px 1fr auto' }}>
          <span />
          <span>Project</span>
          <span>Framework</span>
        </div>
        {projects.map((p) => (
          <div
            key={p.path}
            className="matrix-row"
            style={{ gridTemplateColumns: '22px 1fr auto' }}
          >
            <input
              type="checkbox"
              checked={selected.has(p.path)}
              onChange={() => toggle(p.path)}
              aria-label={`Add to ${p.name}`}
            />
            <span className="matrix-proj">{p.name}</span>
            <span className="matrix-tfm">{p.targetFrameworks.join('; ')}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={selected.size === 0}
        onClick={add}
        style={{ marginTop: 10 }}
      >
        Add to {selected.size} {selected.size === 1 ? 'project' : 'projects'}
      </button>
    </div>
  );
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
