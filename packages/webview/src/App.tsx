import { useEffect, useReducer } from 'react';
import type { HostMessage } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';
import { vscode } from './vscode.js';
import { reducer, initialState } from './state/reducer.js';
import { CommonPackages } from './components/CommonPackages.js';
import { FilterBar } from './components/FilterBar.js';
import { ProjectList } from './components/ProjectList.js';
import { SearchPanel } from './components/SearchPanel.js';
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
      {state.search.visible ? (
        <SearchPanel
          projects={state.projects}
          query={state.search.query}
          results={state.search.results}
          onQueryChange={(query) => dispatch({ type: 'setSearchQuery', query })}
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
        versionsByPackage={state.versionsByPackage}
        expanded={state.expanded}
        onToggleExpanded={(projectPath, packageId) =>
          dispatch({ type: 'toggleExpanded', projectPath, packageId })
        }
      />
      {state.sources.length > 1 ? (
        <details className="sources-footer">
          <summary>
            <span className="muted">Configured sources ({state.sources.filter((s) => s.enabled).length} active)</span>
          </summary>
          <ul className="sources-list">
            {state.sources.map((src) => (
              <li key={src.name} className={src.enabled ? '' : 'source-disabled'}>
                <span className="source-name">{src.name}</span>
                <span className="muted source-url">{src.url}</span>
                {!src.enabled ? <span className="badge badge-source-off">disabled</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
