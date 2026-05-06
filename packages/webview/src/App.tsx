import { useEffect, useReducer } from 'react';
import type { HostMessage } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';
import { vscode } from './vscode.js';
import { reducer, initialState } from './state/reducer.js';
import { FilterBar } from './components/FilterBar.js';
import { ProjectList } from './components/ProjectList.js';
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
    </div>
  );
}
