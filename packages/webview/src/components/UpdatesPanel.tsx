import { useMemo, useState } from 'react';
import type { PackageRow, Project } from '@nuget-compass/shared';
import { aggregatePackages, type AggregatedPackage } from '../state/aggregate.js';
import type { SelectedPackage } from '../state/reducer.js';
import { GenericEmpty } from './EmptyState.js';
import type { BulkUpdateItem } from './ConfirmBulkUpdateModal.js';

interface UpdatesPanelProps {
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  filterQuery: string;
  selectedPackage: SelectedPackage | undefined;
  onSelect: (pkg: AggregatedPackage) => void;
  onBulkUpdate: (items: BulkUpdateItem[]) => void;
}

/**
 * Cross-project update center: every package with at least one available
 * update across the workspace, with bulk-select and a single Update action
 * that fans out to every project that needs the bump.
 */
export function UpdatesPanel({
  projects,
  rowsByProject,
  filterQuery,
  selectedPackage,
  onSelect,
  onBulkUpdate,
}: UpdatesPanelProps): React.JSX.Element {
  const updatable = useMemo(() => {
    const pkgs = aggregatePackages(rowsByProject, projects, false);
    return pkgs.filter((p) => p.hasUpdate);
  }, [projects, rowsByProject]);

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return updatable;
    return updatable.filter((p) => p.id.toLowerCase().includes(q));
  }, [updatable, filterQuery]);

  const [checked, setChecked] = useState<Set<string>>(() => new Set(updatable.map((p) => p.id)));

  // Keep checked-set in sync if the underlying list grows/shrinks.
  const allIds = filtered.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => checked.has(id));

  function toggle(id: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setChecked(allSelected ? new Set() : new Set(allIds));
  }

  function applySelected(): void {
    const items: BulkUpdateItem[] = [];
    for (const pkg of filtered) {
      if (!checked.has(pkg.id)) continue;
      const target = pkg.latestNewer;
      if (!target) continue;
      const projectPaths: string[] = [];
      const fromVersions = new Set<string>();
      let hasTransitive = false;
      for (const inst of pkg.installs) {
        if (inst.newestAllowed && inst.newestAllowed !== inst.resolvedVersion) {
          projectPaths.push(inst.projectPath);
          fromVersions.add(inst.resolvedVersion);
          if (inst.isTransitive) hasTransitive = true;
        }
      }
      if (projectPaths.length === 0) continue;
      items.push({
        packageId: pkg.id,
        toVersion: target,
        fromVersions: Array.from(fromVersions),
        projectPaths,
        hasTransitive,
      });
    }
    if (items.length > 0) onBulkUpdate(items);
  }

  if (updatable.length === 0) {
    return (
      <GenericEmpty
        title="Everything is up to date."
        sub="No package in this workspace has a newer compatible version."
      />
    );
  }

  return (
    <div>
      <div className="upd-bar">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          aria-label="Select all updatable packages"
        />
        <span style={{ fontSize: '0.808rem' }}>Select all</span>
        <span className="upd-bar-meta">
          {checked.size} of {filtered.length}
        </span>
        <button
          type="button"
          className="upd-bar-button"
          disabled={checked.size === 0}
          onClick={applySelected}
        >
          Update {checked.size > 0 ? `(${checked.size})` : ''}
        </button>
      </div>
      {filtered.length === 0 ? (
        <GenericEmpty title="No updates match the current filter." />
      ) : null}
      {filtered.map((pkg) => {
        const isSel =
          selectedPackage?.packageId === pkg.id &&
          pkg.installs.some((i) => i.projectPath === selectedPackage?.projectPath);
        return (
          <UpdateRow
            key={pkg.id}
            pkg={pkg}
            checked={checked.has(pkg.id)}
            selected={isSel}
            onCheck={() => toggle(pkg.id)}
            onSelect={() => onSelect(pkg)}
          />
        );
      })}
    </div>
  );
}

function UpdateRow({
  pkg,
  checked,
  selected,
  onCheck,
  onSelect,
}: {
  pkg: AggregatedPackage;
  checked: boolean;
  selected: boolean;
  onCheck: () => void;
  onSelect: () => void;
}): React.JSX.Element {
  const updProjects = pkg.installs.filter(
    (i) => i.newestAllowed && i.newestAllowed !== i.resolvedVersion,
  );
  return (
    <button
      type="button"
      className={'upd-row' + (selected ? ' upd-row-selected' : '')}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          onCheck();
        }}
        aria-label={`Select ${pkg.id}`}
      />
      <span className="upd-row-info">
        <span className="upd-row-head">
          <span className="upd-row-id">{pkg.id}</span>
          {pkg.hasVulnerability ? (
            <span className="badge badge-vuln">⚠ {pkg.highestVulnSeverity}</span>
          ) : null}
        </span>
        <span className="upd-row-chips">
          {updProjects.map((inst) => (
            <span key={inst.projectPath} className="proj-chip proj-chip-update">
              <span className="proj-chip-dot" />
              <span className="proj-chip-name">{inst.projectName}</span>
              <span className="proj-chip-ver">{inst.resolvedVersion}</span>
            </span>
          ))}
        </span>
      </span>
      <span className="upd-row-target">→ {pkg.latestNewer}</span>
    </button>
  );
}
