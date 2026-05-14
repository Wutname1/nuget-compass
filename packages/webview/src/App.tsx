import { useEffect, useMemo, useReducer, useState } from 'react';
import type { HostMessage, FilterState } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';
import { vscode } from './vscode.js';
import { reducer, initialState, type SearchHit } from './state/reducer.js';
import { aggregatePackages, type AggregatedPackage } from './state/aggregate.js';
import { InstalledList } from './components/InstalledList.js';
import { BrowsePanel } from './components/BrowsePanel.js';
import { UpdatesPanel } from './components/UpdatesPanel.js';
import { ActivityPanel } from './components/ActivityPanel.js';
import { BulkProgressModal, BulkProgressPill } from './components/BulkProgressModal.js';
import {
  DetailPanel,
  type DetailSelection,
  type UpdateRequest,
} from './components/DetailPanel.js';
import { StatusBanner } from './components/StatusBanner.js';
import { DiagnosticsPanel } from './components/DiagnosticsPanel.js';
import { SourcesPanel } from './components/SourcesPanel.js';
import { Toast } from './components/Toast.js';
import { ConfirmUpdateModal } from './components/ConfirmUpdateModal.js';
import {
  ConfirmBulkUpdateModal,
  type BulkUpdateItem,
} from './components/ConfirmBulkUpdateModal.js';
import { AddSourceModal } from './components/AddSourceModal.js';
import {
  CompassIcon,
  SearchIcon,
  ListIcon,
  FolderIcon,
  LockIcon,
  GearIcon,
} from './components/icons.js';

let nextToastId = 1;

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    filters: defaultFilterState,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateRequest | undefined>();
  const [pendingBulkUpdate, setPendingBulkUpdate] = useState<BulkUpdateItem[] | undefined>();
  const [selectedHit, setSelectedHit] = useState<SearchHit | undefined>();

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      const msg = event.data;
      if (msg.type === 'host:init' || msg.type === 'host:fontScale') {
        const clamped = Math.min(1.5, Math.max(0.7, msg.fontScale));
        document.documentElement.style.setProperty('--ngc-font-scale', String(clamped));
      }
      dispatch({ type: 'host', message: msg });
      if (msg.type === 'host:packageRows' || msg.type === 'host:projects') {
        setRefreshing(false);
      }
      if (msg.type === 'host:bulkCompleted') {
        const noun =
          msg.succeeded === 1 ? 'package' : 'packages';
        const summary = msg.cancelled
          ? `Cancelled. ${msg.succeeded} ${noun} updated, ${msg.failed} failed.`
          : msg.aborted
            ? `Stopped after repeated failures. ${msg.succeeded} ${noun} updated, ${msg.failed} failed.`
            : msg.failed > 0
              ? `${msg.succeeded} of ${msg.succeeded + msg.failed} ${noun} updated.`
              : `${msg.succeeded} ${noun} updated.`;
        dispatch({
          type: 'showToast',
          toast: { id: nextToastId++, kind: msg.failed > 0 ? 'info' : 'success', message: summary },
        });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'view:ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Map id selection back to an aggregated package for the detail panel.
  const aggregated = useMemo(
    () => aggregatePackages(state.rowsByProject, state.projects, state.filters.showTransitive),
    [state.rowsByProject, state.projects, state.filters.showTransitive],
  );
  const selectedAggregated = useMemo<AggregatedPackage | undefined>(() => {
    if (!state.selectedPackage) return undefined;
    return aggregated.find((p) => p.id === state.selectedPackage!.packageId);
  }, [aggregated, state.selectedPackage]);

  // The detail selection depends on the active tab.
  const detailSelection: DetailSelection | undefined = useMemo(() => {
    if (state.tab === 'browse') {
      return selectedHit ? { kind: 'browse', hit: selectedHit } : undefined;
    }
    return selectedAggregated ? { kind: 'installed', pkg: selectedAggregated } : undefined;
  }, [state.tab, selectedHit, selectedAggregated]);

  function selectPackage(pkg: AggregatedPackage): void {
    // Toggle: re-select clears the panel.
    if (state.selectedPackage?.packageId === pkg.id) {
      dispatch({ type: 'selectPackage', selection: undefined });
      return;
    }
    const first = pkg.installs[0];
    if (!first) return;
    dispatch({
      type: 'selectPackage',
      selection: { projectPath: first.projectPath, packageId: pkg.id },
    });
  }

  function setTab(tab: typeof state.tab): void {
    dispatch({ type: 'setTab', tab });
    // Clear cross-tab selections to avoid surfacing stale detail content.
    if (tab !== 'browse') setSelectedHit(undefined);
    if (tab === 'browse') dispatch({ type: 'selectPackage', selection: undefined });
  }

  function handleRefresh(forceCacheBust: boolean): void {
    setRefreshing(true);
    vscode.postMessage({ type: 'view:refresh', forceCacheBust });
    // Belt-and-braces: stop spinning after a few seconds even if no update arrives.
    setTimeout(() => setRefreshing(false), 4000);
  }

  function applyFilters(filters: FilterState): void {
    dispatch({ type: 'setFilters', filters });
    vscode.postMessage({ type: 'view:setFilters', filters });
  }

  function handleUpdateRequest(req: UpdateRequest): void {
    setPendingUpdate(req);
  }

  function confirmUpdate(): void {
    if (!pendingUpdate) return;
    for (const projectPath of pendingUpdate.projectPaths) {
      vscode.postMessage({
        type: 'view:updatePackage',
        projectPath,
        packageId: pendingUpdate.packageId,
        toVersion: pendingUpdate.toVersion,
        confirmed: true,
      });
    }
    dispatch({
      type: 'showToast',
      toast: {
        id: nextToastId++,
        kind: 'success',
        message: `Updating ${pendingUpdate.packageId} to ${pendingUpdate.toVersion} in ${pendingUpdate.projectPaths.length} ${
          pendingUpdate.projectPaths.length === 1 ? 'project' : 'projects'
        }.`,
      },
    });
    setPendingUpdate(undefined);
  }

  function handleBulkUpdateRequest(items: BulkUpdateItem[]): void {
    if (items.length === 0) return;
    setPendingBulkUpdate(items);
  }

  function confirmBulkUpdate(): void {
    if (!pendingBulkUpdate) return;
    let projectCount = 0;
    for (const item of pendingBulkUpdate) {
      for (const projectPath of item.projectPaths) {
        projectCount += 1;
        vscode.postMessage({
          type: 'view:updatePackage',
          projectPath,
          packageId: item.packageId,
          toVersion: item.toVersion,
          confirmed: true,
        });
      }
    }
    dispatch({
      type: 'showToast',
      toast: {
        id: nextToastId++,
        kind: 'success',
        message: `Updating ${pendingBulkUpdate.length} ${
          pendingBulkUpdate.length === 1 ? 'package' : 'packages'
        } across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}.`,
      },
    });
    setPendingBulkUpdate(undefined);
  }

  // Counts for the inner-tab pills.
  const updateCount = useMemo(() => aggregated.filter((p) => p.hasUpdate).length, [aggregated]);

  // Unread activity (errors/warnings) since the user last visited the tab.
  const activityUnread = useMemo(() => {
    if (state.tab === 'activity') return { errors: 0, warnings: 0 };
    let errors = 0;
    let warnings = 0;
    for (const e of state.activity) {
      if (e.id <= state.activityLastSeenId) continue;
      if (e.level === 'error') errors++;
      else if (e.level === 'warn') warnings++;
    }
    return { errors, warnings };
  }, [state.activity, state.activityLastSeenId, state.tab]);
  const vulnCount = useMemo(
    () => aggregated.filter((p) => p.hasVulnerability).length,
    [aggregated],
  );

  // Any project with CPM enabled?
  const hasCpm = state.projects.some((p) => Boolean(p.centralPackageManagement));

  const projectNames = useMemo(
    () => Object.fromEntries(state.projects.map((p) => [p.path, p.name])),
    [state.projects],
  );

  const browseFilterPlaceholder =
    state.tab === 'browse' ? 'Search packages…' : 'Filter packages…';

  function onBrowseSearchSubmit(): void {
    const q = state.filterQuery.trim();
    if (q.length === 0) return;
    vscode.postMessage({ type: 'view:searchPackages', query: q });
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="app-header-brand-icon" style={{ color: 'var(--nc-accent)' }}>
            <CompassIcon size={13} />
          </span>
          NuGet Compass
          {state.projects.length > 0 ? (
            <span className="app-header-meta">
              · {state.projects.length} {state.projects.length === 1 ? 'project' : 'projects'}
            </span>
          ) : null}
        </h1>
        <div className="app-header-actions">
          {state.bulkProgress && state.bulkProgressMinimized ? (
            <BulkProgressPill
              state={state.bulkProgress}
              onRestore={() => dispatch({ type: 'restoreBulkProgress' })}
              onCancel={() =>
                state.bulkProgress &&
                vscode.postMessage({
                  type: 'view:cancelBulkOperation',
                  id: state.bulkProgress.id,
                })
              }
            />
          ) : null}
          <button
            type="button"
            className={'icon-button' + (refreshing ? ' icon-button-spinning' : '')}
            title="Refresh (Shift-click to clear cache)"
            onClick={(e) => handleRefresh(e.shiftKey)}
          >
            ↻
          </button>
          <button
            type="button"
            className="icon-button"
            title="Open NuGet Compass settings"
            aria-label="Open settings"
            onClick={() => vscode.postMessage({ type: 'view:openSettings' })}
          >
            <GearIcon size={13} />
          </button>
        </div>
      </header>

      <div className="inner-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={state.tab === 'installed'}
          className={'inner-tab' + (state.tab === 'installed' ? ' inner-tab-active' : '')}
          onClick={() => setTab('installed')}
        >
          Installed
          {vulnCount > 0 ? <span className="pill warn">{vulnCount}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.tab === 'browse'}
          className={'inner-tab' + (state.tab === 'browse' ? ' inner-tab-active' : '')}
          onClick={() => setTab('browse')}
        >
          Browse
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.tab === 'updates'}
          className={'inner-tab' + (state.tab === 'updates' ? ' inner-tab-active' : '')}
          onClick={() => setTab('updates')}
        >
          Updates
          {updateCount > 0 ? <span className="pill">{updateCount}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.tab === 'activity'}
          className={'inner-tab' + (state.tab === 'activity' ? ' inner-tab-active' : '')}
          onClick={() => setTab('activity')}
        >
          Activity
          {activityUnread.errors > 0 ? (
            <span className="pill pill-error" title={`${activityUnread.errors} new error(s)`}>
              {activityUnread.errors}
            </span>
          ) : activityUnread.warnings > 0 ? (
            <span
              className="pill caution"
              title={`${activityUnread.warnings} new warning(s)`}
            >
              {activityUnread.warnings}
            </span>
          ) : null}
        </button>
        <span className="inner-tabs-spacer" />
        {hasCpm ? (
          <span
            className="inner-tabs-cpm"
            title="Central Package Management active — versions pinned in Directory.Packages.props"
          >
            <LockIcon size={10} />
            CPM
          </span>
        ) : null}
      </div>

      {state.tab !== 'activity' ? (
      <div className="filter-bar">
        <span className="search-box">
          <span className="search-box-icon">
            <SearchIcon size={11} />
          </span>
          <input
            type="search"
            value={state.filterQuery}
            placeholder={browseFilterPlaceholder}
            onChange={(e) => dispatch({ type: 'setFilterQuery', query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && state.tab === 'browse') onBrowseSearchSubmit();
              if (e.key === 'Escape') dispatch({ type: 'setFilterQuery', query: '' });
            }}
          />
          {state.filterQuery.length > 0 ? (
            <button
              type="button"
              className="search-box-clear"
              onClick={() => dispatch({ type: 'setFilterQuery', query: '' })}
              aria-label="Clear filter"
              title="Clear (Esc)"
            >
              ×
            </button>
          ) : null}
        </span>

        <label className="filter-label-checkbox">
          <input
            type="checkbox"
            checked={state.filters.includePrerelease}
            onChange={(e) =>
              applyFilters({ ...state.filters, includePrerelease: e.target.checked })
            }
          />
          <span>Prerelease</span>
        </label>

        {state.tab === 'installed' ? (
          <>
            <span className="seg" role="group" aria-label="Group by">
              <button
                type="button"
                className={'seg-btn' + (state.groupBy === 'package' ? ' seg-btn-active' : '')}
                onClick={() => dispatch({ type: 'setGroupBy', groupBy: 'package' })}
                aria-pressed={state.groupBy === 'package'}
              >
                <ListIcon size={10} />
                By package
              </button>
              <button
                type="button"
                className={'seg-btn' + (state.groupBy === 'project' ? ' seg-btn-active' : '')}
                onClick={() => dispatch({ type: 'setGroupBy', groupBy: 'project' })}
                aria-pressed={state.groupBy === 'project'}
              >
                <FolderIcon size={10} />
                By project
              </button>
            </span>
            <label className="filter-label">
              <span>Framework:</span>
              <select
                value={state.filters.tfm}
                onChange={(e) =>
                  applyFilters({
                    ...state.filters,
                    tfm: e.target.value as FilterState['tfm'],
                  })
                }
              >
                <option value="compatible">Compatible</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="filter-label">
              <span>Update:</span>
              <select
                value={state.filters.updateLevel}
                onChange={(e) =>
                  applyFilters({
                    ...state.filters,
                    updateLevel: e.target.value as FilterState['updateLevel'],
                  })
                }
              >
                <option value="patch">Patch</option>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
              </select>
            </label>
            <label className="filter-label-checkbox">
              <input
                type="checkbox"
                checked={state.filters.showTransitive}
                onChange={(e) =>
                  applyFilters({ ...state.filters, showTransitive: e.target.checked })
                }
              />
              <span>Transitive</span>
            </label>
          </>
        ) : null}

        {state.tab === 'browse' ? (
          <button type="button" className="btn-secondary" onClick={onBrowseSearchSubmit}>
            Search
          </button>
        ) : null}
      </div>
      ) : null}

      <StatusBanner
        status={state.status}
        error={state.error}
        onOpenActivity={() => setTab('activity')}
      />

      <DiagnosticsPanel
        diagnostics={state.diagnostics}
        suppressedCodes={state.suppressedCodes}
        fixesInFlight={state.fixesInFlight}
        fixResults={state.fixResults}
        onApplyFix={(key, fix) => {
          dispatch({ type: 'fixStarted', key });
          vscode.postMessage({ type: 'view:applyDiagnosticFix', key, fix });
          if (fix.kind === 'update-package' || fix.kind === 'reveal-package') {
            // Jump the user to the package in the Installed list so they can
            // pick a version themselves. The host echoes a host:fixResult so
            // the panel still shows feedback.
            dispatch({ type: 'setTab', tab: 'installed' });
            const first = state.projects.find((p) =>
              p.packages.some((pkg) => pkg.id === fix.packageId),
            );
            if (first) {
              dispatch({
                type: 'selectPackage',
                selection: { projectPath: first.path, packageId: fix.packageId },
              });
            }
          }
        }}
        onSuppressCode={(code, suppressed) =>
          vscode.postMessage({ type: 'view:suppressDiagnosticCode', code, suppressed })
        }
        onDismissFixResult={(key) => dispatch({ type: 'dismissFixResult', key })}
      />

      <div className="app-body">
        <main className="app-main">
          {state.tab === 'activity' ? (
            <ActivityPanel
              entries={state.activity}
              filters={state.activityFilters}
              onSetLevel={(level, enabled) =>
                dispatch({ type: 'setActivityLevel', level, enabled })
              }
              onSetCategory={(category) =>
                dispatch({ type: 'setActivityCategory', category })
              }
              onClear={() => vscode.postMessage({ type: 'view:clearActivity' })}
              onRevealOutputChannel={() =>
                vscode.postMessage({ type: 'view:revealOutputChannel' })
              }
            />
          ) : (
          <div className="scroll-area">
            {state.tab === 'installed' ? (
              <InstalledList
                projects={state.projects}
                rowsByProject={state.rowsByProject}
                projectStatus={state.projectStatus}
                groupBy={state.groupBy}
                showTransitive={state.filters.showTransitive}
                filterQuery={state.filterQuery}
                selectedPackage={state.selectedPackage}
                onSelect={selectPackage}
              />
            ) : null}
            {state.tab === 'browse' ? (
              <BrowsePanel
                projects={state.projects}
                query={state.search.query}
                results={state.search.results}
                includePrerelease={state.filters.includePrerelease}
                selectedHitId={selectedHit?.id}
                onSelectHit={(hit) => {
                  setSelectedHit(hit);
                  dispatch({ type: 'selectPackage', selection: undefined });
                }}
              />
            ) : null}
            {state.tab === 'updates' ? (
              <UpdatesPanel
                projects={state.projects}
                rowsByProject={state.rowsByProject}
                filterQuery={state.filterQuery}
                selectedPackage={state.selectedPackage}
                onSelect={selectPackage}
                onBulkUpdate={handleBulkUpdateRequest}
              />
            ) : null}
          </div>
          )}
          <SourcesPanel sources={state.sources} />
        </main>
        {state.tab !== 'activity' ? (
        <aside className="app-detail">
          <DetailPanel
            selection={detailSelection}
            context={state.tab}
            projects={state.projects}
            versionsByPackage={state.versionsByPackage}
            filters={state.filters}
            readmes={state.readmes}
            onClose={() => {
              dispatch({ type: 'selectPackage', selection: undefined });
              setSelectedHit(undefined);
            }}
            onUpdateConfirm={handleUpdateRequest}
          />
        </aside>
        ) : null}
      </div>

      <ConfirmUpdateModal
        request={pendingUpdate}
        projectNames={projectNames}
        onCancel={() => setPendingUpdate(undefined)}
        onConfirm={confirmUpdate}
      />

      <ConfirmBulkUpdateModal
        items={pendingBulkUpdate}
        projectNames={projectNames}
        onCancel={() => setPendingBulkUpdate(undefined)}
        onConfirm={confirmBulkUpdate}
      />

      {state.authPrompt ? (
        <AddSourceModal
          reauthFor={{
            name: state.authPrompt.name,
            url: state.authPrompt.url,
            credentialStore: state.authPrompt.credentialStore,
          }}
          onClose={() => dispatch({ type: 'dismissAuthPrompt' })}
        />
      ) : null}

      {state.bulkProgress && !state.bulkProgressMinimized ? (
        <BulkProgressModal
          state={state.bulkProgress}
          onMinimize={() => dispatch({ type: 'minimizeBulkProgress' })}
          onCancel={() =>
            state.bulkProgress &&
            vscode.postMessage({
              type: 'view:cancelBulkOperation',
              id: state.bulkProgress.id,
            })
          }
        />
      ) : null}

      <Toast toast={state.toast} onDismiss={() => dispatch({ type: 'dismissToast' })} />
    </div>
  );
}
