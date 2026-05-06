import { useEffect, useReducer } from 'react';
import type { HostMessage } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';
import { vscode } from './vscode.js';
import { reducer, initialState } from './state/reducer.js';
import { CommonPackages } from './components/CommonPackages.js';
import { DetailPanel } from './components/DetailPanel.js';
import { FilterBar } from './components/FilterBar.js';
import { ProjectList } from './components/ProjectList.js';
import { SearchPanel } from './components/SearchPanel.js';
import { SourcesPanel } from './components/SourcesPanel.js';
import { StatusBanner } from './components/StatusBanner.js';

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    filters: defaultFilterState,
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      dispatch({ type: 'host', message: event.data });
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'view:ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // When a package is selected, request its versions if we don't have them.
  useEffect(() => {
    if (!state.selectedPackage) return;
    const key = `${state.selectedPackage.projectPath}::${state.selectedPackage.packageId}`;
    if (state.versionsByPackage[key]) return;
    vscode.postMessage({
      type: 'view:expandPackage',
      projectPath: state.selectedPackage.projectPath,
      packageId: state.selectedPackage.packageId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedPackage?.projectPath, state.selectedPackage?.packageId]);

  const selectedRow = state.selectedPackage
    ? state.rowsByProject[state.selectedPackage.projectPath]?.find(
        (r) => r.package.id === state.selectedPackage!.packageId,
      )
    : undefined;
  const selectedProject = state.selectedPackage
    ? state.projects.find((p) => p.path === state.selectedPackage!.projectPath)
    : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <h1>NuGet Compass</h1>
        <div className="app-header-actions">
          <button
            type="button"
            className={'icon-button' + (state.search.visible ? ' icon-button-active' : '')}
            title="Search NuGet"
            aria-pressed={state.search.visible}
            onClick={() => dispatch({ type: 'toggleSearch' })}
          >
            🔍
          </button>
          <button
            type="button"
            className="icon-button"
            title="Refresh (Shift-click to clear cache)"
            onClick={(e) =>
              vscode.postMessage({
                type: 'view:refresh',
                forceCacheBust: e.shiftKey,
              })
            }
          >
            ↻
          </button>
        </div>
      </header>
      <FilterBar
        filters={state.filters}
        onChange={(filters) => {
          dispatch({ type: 'setFilters', filters });
          vscode.postMessage({ type: 'view:setFilters', filters });
        }}
      />
      <StatusBanner status={state.status} error={state.error} />
      <div className="app-body">
        <main className="app-main">
          {state.search.visible ? (
            <SearchPanel
              projects={state.projects}
              query={state.search.query}
              results={state.search.results}
              includePrerelease={state.filters.includePrerelease}
              onQueryChange={(query) => dispatch({ type: 'setSearchQuery', query })}
              onClear={() => dispatch({ type: 'clearSearch' })}
            />
          ) : null}
          {state.projects.length > 1 ? (
            <CommonPackages
              rowsByProject={state.rowsByProject}
              projectNames={Object.fromEntries(state.projects.map((p) => [p.path, p.name]))}
            />
          ) : null}
          <ProjectList
            projects={state.projects}
            rowsByProject={state.rowsByProject}
            projectStatus={state.projectStatus}
            showTransitive={state.filters.showTransitive}
            selectedPackage={state.selectedPackage}
            onSelectPackage={(selection) => dispatch({ type: 'selectPackage', selection })}
          />
        </main>
        <aside className="app-detail">
          <DetailPanel
            row={selectedRow}
            project={selectedProject}
            filters={state.filters}
            versions={
              state.selectedPackage
                ? state.versionsByPackage[
                    `${state.selectedPackage.projectPath}::${state.selectedPackage.packageId}`
                  ]
                : undefined
            }
            readmes={state.readmes}
            onClose={() => dispatch({ type: 'selectPackage', selection: undefined })}
          />
        </aside>
      </div>
      <SourcesPanel sources={state.sources} />
    </div>
  );
}
