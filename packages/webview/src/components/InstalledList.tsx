import { useMemo, useState } from 'react';
import type { Project, PackageRow } from '@nuget-compass/shared';
import {
  aggregatePackages,
  categorize,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type AggregatedPackage,
  type Category,
  type PackageInstall,
} from '../state/aggregate.js';
import type { GroupBy, ProjectStatus, SelectedPackage } from '../state/reducer.js';
import { vscode } from '../vscode.js';
import { PackageRowBadges, InstallBadges } from './PackageBadges.js';
import { GenericEmpty, NoProjectsEmpty } from './EmptyState.js';

interface InstalledListProps {
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  projectStatus: Record<string, ProjectStatus>;
  groupBy: GroupBy;
  showTransitive: boolean;
  filterQuery: string;
  selectedPackage: SelectedPackage | undefined;
  onSelect: (pkg: AggregatedPackage) => void;
}

/**
 * Consolidated list of installed packages. The default `package` view groups
 * a single package across every project that uses it, surfacing version drift.
 * The `project` view falls back to the legacy per-project grouping.
 */
export function InstalledList({
  projects,
  rowsByProject,
  projectStatus,
  groupBy,
  showTransitive,
  filterQuery,
  selectedPackage,
  onSelect,
}: InstalledListProps): React.JSX.Element {
  const packages = useMemo(
    () => aggregatePackages(rowsByProject, projects, showTransitive),
    [rowsByProject, projects, showTransitive],
  );

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter((p) => p.id.toLowerCase().includes(q));
  }, [packages, filterQuery]);

  if (projects.length === 0) {
    return <NoProjectsEmpty />;
  }

  if (groupBy === 'project') {
    return (
      <ByProjectView
        projects={projects}
        packages={filtered}
        rowsByProject={rowsByProject}
        projectStatus={projectStatus}
        showTransitive={showTransitive}
        selectedPackage={selectedPackage}
        onSelect={onSelect}
      />
    );
  }

  return (
    <ByPackageView
      packages={filtered}
      selectedPackage={selectedPackage}
      onSelect={onSelect}
    />
  );
}

/* ─────────────────────────────────────────
   By Package — categorized, with project chips
   ───────────────────────────────────────── */

function ByPackageView({
  packages,
  selectedPackage,
  onSelect,
}: {
  packages: AggregatedPackage[];
  selectedPackage: SelectedPackage | undefined;
  onSelect: (pkg: AggregatedPackage) => void;
}): React.JSX.Element {
  const byCat: Record<Category, AggregatedPackage[]> = {
    vuln: [],
    depr: [],
    outdated: [],
    current: [],
  };
  for (const p of packages) byCat[categorize(p)].push(p);

  if (packages.length === 0) {
    return <GenericEmpty title="No packages match the current filters." />;
  }

  return (
    <div>
      {CATEGORY_ORDER.map((cat) => {
        const items = byCat[cat];
        if (items.length === 0) return null;
        return (
          <CategorySection
            key={cat}
            cat={cat}
            items={items}
            selectedPackage={selectedPackage}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

function CategorySection({
  cat,
  items,
  selectedPackage,
  onSelect,
}: {
  cat: Category;
  items: AggregatedPackage[];
  selectedPackage: SelectedPackage | undefined;
  onSelect: (pkg: AggregatedPackage) => void;
}): React.JSX.Element {
  // 'current' (up-to-date) collapses by default to focus attention on issues.
  const [open, setOpen] = useState(cat !== 'current');
  return (
    <div>
      <button
        type="button"
        className="cat-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`group-chevron${open ? ' group-chevron-open' : ''}`}>▶</span>
        <span>{CATEGORY_LABEL[cat]}</span>
        <span className="cat-count">{items.length}</span>
        <span className="cat-spacer" />
        {cat === 'outdated' ? (
          <span
            className="cat-header-action"
            onClick={(e) => {
              e.stopPropagation();
              // Trigger update-all per project for every project that has updates.
              const projects = new Set<string>();
              for (const pkg of items)
                for (const inst of pkg.installs)
                  if (inst.newestAllowed && inst.newestAllowed !== inst.resolvedVersion)
                    projects.add(inst.projectPath);
              for (const projectPath of projects) {
                vscode.postMessage({ type: 'view:updateAll', projectPath });
              }
            }}
          >
            Update all ↑
          </span>
        ) : null}
      </button>
      {open
        ? items.map((pkg) => (
            <ByPackageRow
              key={pkg.id}
              pkg={pkg}
              selected={isSelected(selectedPackage, pkg)}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

function isSelected(
  selected: SelectedPackage | undefined,
  pkg: AggregatedPackage,
): boolean {
  if (!selected) return false;
  return pkg.installs.some(
    (i) =>
      i.projectPath === selected.projectPath && pkg.id === selected.packageId,
  );
}

function ByPackageRow({
  pkg,
  selected,
  onSelect,
}: {
  pkg: AggregatedPackage;
  selected: boolean;
  onSelect: (pkg: AggregatedPackage) => void;
}): React.JSX.Element {
  const updatableProjects = pkg.installs.filter(
    (i) => i.newestAllowed && i.newestAllowed !== i.resolvedVersion,
  );

  // Determine target version display
  let versionDisplay: React.JSX.Element;
  if (pkg.isDivergent) {
    versionDisplay = (
      <span className="pkg-target-line">
        <span className="pkg-target-current pkg-target-current-divergent">
          {pkg.versions.length} versions
        </span>
        {pkg.latestNewer ? (
          <>
            <span className="pkg-target-arrow">→</span>
            <span className="pkg-target-newer">{pkg.latestNewer}</span>
          </>
        ) : null}
      </span>
    );
  } else {
    versionDisplay = (
      <span className="pkg-target-line">
        <span className="pkg-target-current">{pkg.versions[0]}</span>
        {pkg.latestNewer && pkg.latestNewer !== pkg.versions[0] ? (
          <>
            <span className="pkg-target-arrow">→</span>
            <span className="pkg-target-newer">{pkg.latestNewer}</span>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={
        'pkg-row' +
        (selected ? ' pkg-row-selected' : '') +
        (pkg.isTransitive ? ' pkg-row-transitive' : '')
      }
      onClick={() => onSelect(pkg)}
      aria-pressed={selected}
    >
      <span className="pkg-id-cell">
        <span className="pkg-id-line">
          <span className={'pkg-id' + (pkg.isTransitive ? ' pkg-id-transitive' : '')}>
            {pkg.id}
          </span>
          <span className="badges">
            <PackageRowBadges pkg={pkg} />
          </span>
        </span>
        <span className="pkg-projects-line">
          {pkg.installs.map((inst) => (
            <ProjectChip key={inst.projectPath} install={inst} />
          ))}
        </span>
      </span>
      <span className="pkg-target">
        {versionDisplay}
        <span className="pkg-target-meta">
          <span className="meta-count">
            {pkg.installs.length} {pkg.installs.length === 1 ? 'project' : 'projects'}
          </span>
          {updatableProjects.length > 0 ? (
            <span className="meta-update">{updatableProjects.length} can update</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function ProjectChip({ install }: { install: PackageInstall }): React.JSX.Element {
  const isUpdate = Boolean(install.newestAllowed) && install.newestAllowed !== install.resolvedVersion;
  const hasVuln = install.vulnerability && install.vulnerability.length > 0;
  const cls =
    'proj-chip' +
    (isUpdate ? ' proj-chip-update' : '') +
    (hasVuln ? ' proj-chip-vuln' : '');
  const titleBits = [
    `${install.projectName} (${install.targetFrameworks.join('; ')}) — ${install.resolvedVersion}`,
  ];
  if (hasVuln) titleBits.push('Has a known security problem in this project. Update to a fixed version.');
  if (isUpdate) titleBits.push(`A newer version is available: ${install.newestAllowed}`);
  return (
    <span
      className={cls}
      title={titleBits.join('\n')}
    >
      <span className="proj-chip-dot" />
      <span className="proj-chip-name">{install.projectName}</span>
      <span className="proj-chip-ver">{install.resolvedVersion}</span>
    </span>
  );
}

/* ─────────────────────────────────────────
   By Project — legacy grouping (one section per project)
   ───────────────────────────────────────── */

function ByProjectView({
  projects,
  packages,
  rowsByProject,
  projectStatus,
  showTransitive,
  selectedPackage,
  onSelect,
}: {
  projects: Project[];
  packages: AggregatedPackage[];
  rowsByProject: Record<string, PackageRow[]>;
  projectStatus: Record<string, ProjectStatus>;
  showTransitive: boolean;
  selectedPackage: SelectedPackage | undefined;
  onSelect: (pkg: AggregatedPackage) => void;
}): React.JSX.Element {
  // Build a quick lookup of aggregated packages by id for selection routing.
  const pkgById = useMemo(() => {
    const m = new Map<string, AggregatedPackage>();
    for (const p of packages) m.set(p.id, p);
    return m;
  }, [packages]);

  return (
    <div>
      {projects.map((p) => {
        const rows = rowsByProject[p.path] ?? [];
        const visibleRows = rows.filter((r) => showTransitive || !r.package.isTransitive);
        // Apply package-id filter via packages set membership.
        const filteredRows = visibleRows.filter((r) => pkgById.has(r.package.id));
        const status = projectStatus[p.path];
        return (
          <ProjectGroup
            key={p.path}
            project={p}
            rows={filteredRows}
            pkgById={pkgById}
            status={status}
            selectedPackage={selectedPackage}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

function ProjectGroup({
  project,
  rows,
  pkgById,
  status,
  selectedPackage,
  onSelect,
}: {
  project: Project;
  rows: PackageRow[];
  pkgById: Map<string, AggregatedPackage>;
  status: ProjectStatus | undefined;
  selectedPackage: SelectedPackage | undefined;
  onSelect: (pkg: AggregatedPackage) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const updateCount = rows.filter(
    (r) => r.newestAllowed && r.newestAllowed !== r.package.resolvedVersion,
  ).length;
  const vulnCount = rows.filter(
    (r) => r.vulnerability && r.vulnerability.length > 0,
  ).length;
  const isEnriching = status?.status === 'enriching';
  const isReady = status?.status === 'ready';

  return (
    <div>
      <button
        type="button"
        className="group-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`group-chevron${open ? ' group-chevron-open' : ''}`}>▶</span>
        <span className="group-name">{project.name}</span>
        <span className="group-tfm">{project.targetFrameworks.join('; ')}</span>
        {project.centralPackageManagement ? (
          <span
            className="badge badge-cpm"
            title={`Central Package Management (${project.centralPackageManagement.propsPath})`}
          >
            CPM
          </span>
        ) : null}
        {project.lockFilePath ? (
          <span className="badge badge-locked" title={`Locked: ${project.lockFilePath}`}>
            locked
          </span>
        ) : null}
        <span className="group-meta">
          <span className="pip">{rows.length} pkg</span>
          {updateCount > 0 ? (
            <span
              className="pip pip-upd"
              title={`${updateCount} package${updateCount === 1 ? ' has' : 's have'} a newer version available.`}
            >
              ↑ {updateCount}
            </span>
          ) : null}
          {vulnCount > 0 ? (
            <span
              className="pip pip-vuln"
              title={`${vulnCount} package${vulnCount === 1 ? ' has' : 's have'} a known security problem. Update to a fixed version.`}
            >
              ⚠ {vulnCount}
            </span>
          ) : null}
          {isEnriching && status?.progress ? (
            <span className="group-progress">
              {status.progress.done}/{status.progress.total} loaded
            </span>
          ) : null}
        </span>
        {isReady && updateCount > 0 ? (
          <button
            type="button"
            className="group-action"
            onClick={(e) => {
              e.stopPropagation();
              vscode.postMessage({ type: 'view:updateAll', projectPath: project.path });
            }}
            title={`Update ${updateCount} package(s) in ${project.name}`}
          >
            Update all
          </button>
        ) : null}
      </button>
      {open
        ? rows.map((row) => {
            const pkg = pkgById.get(row.package.id);
            if (!pkg) return null;
            const selected =
              selectedPackage?.projectPath === project.path &&
              selectedPackage?.packageId === row.package.id;
            return (
              <ProjectPackageRow
                key={row.package.id}
                row={row}
                pkg={pkg}
                selected={selected}
                onSelect={onSelect}
              />
            );
          })
        : null}
    </div>
  );
}

function ProjectPackageRow({
  row,
  pkg,
  selected,
  onSelect,
}: {
  row: PackageRow;
  pkg: AggregatedPackage;
  selected: boolean;
  onSelect: (pkg: AggregatedPackage) => void;
}): React.JSX.Element {
  const install: PackageInstall | undefined = pkg.installs.find(
    (i) => i.row === row,
  );
  const newer = row.newestAllowed && row.newestAllowed !== row.package.resolvedVersion;
  return (
    <button
      type="button"
      className={
        'pkg-row' +
        (selected ? ' pkg-row-selected' : '') +
        (row.package.isTransitive ? ' pkg-row-transitive' : '')
      }
      onClick={() => onSelect(pkg)}
      aria-pressed={selected}
      style={{ gridTemplateColumns: '1fr auto' }}
    >
      <span className="pkg-id-cell">
        <span className="pkg-id-line">
          <span
            className={'pkg-id' + (row.package.isTransitive ? ' pkg-id-transitive' : '')}
          >
            {row.package.id}
          </span>
          <span className="badges">
            {install ? <InstallBadges install={install} /> : null}
            {pkg.isDivergent ? (
              <span
                className="pkg-divergent-warn"
                title={`Different versions of this package are used across projects. Pick one to keep things in sync.\n\nVersions in use: ${pkg.versions.join(', ')}`}
              >
                ≠
              </span>
            ) : null}
          </span>
        </span>
      </span>
      <span className="pkg-target">
        <span className="pkg-target-line">
          <span className="pkg-target-current">{row.package.resolvedVersion}</span>
          {newer ? (
            <>
              <span className="pkg-target-arrow">→</span>
              <span className="pkg-target-newer">{row.newestAllowed}</span>
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}
