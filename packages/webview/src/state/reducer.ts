import type { FilterState, HostMessage, PackageRow, Project } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';

export interface AppState {
  filters: FilterState;
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  /** Versions returned from a host:packageVersions message, keyed by `${projectPath}::${packageId}`. */
  versionsByPackage: Record<string, import('@nuget-compass/shared').AvailableVersion[]>;
  /** Which packages are expanded in the UI. Same key shape as versionsByPackage. */
  expanded: Record<string, true>;
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
}

export const initialState: AppState = {
  filters: defaultFilterState,
  projects: [],
  rowsByProject: {},
  versionsByPackage: {},
  expanded: {},
  status: 'idle',
};

export type Action =
  | { type: 'host'; message: HostMessage }
  | { type: 'setFilters'; filters: FilterState }
  | { type: 'toggleExpanded'; projectPath: string; packageId: string };

export function packageKey(projectPath: string, packageId: string): string {
  return `${projectPath}::${packageId}`;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setFilters':
      return { ...state, filters: action.filters };
    case 'toggleExpanded': {
      const key = packageKey(action.projectPath, action.packageId);
      const next = { ...state.expanded };
      if (next[key]) delete next[key];
      else next[key] = true;
      return { ...state, expanded: next };
    }
    case 'host':
      return applyHostMessage(state, action.message);
  }
}

function applyHostMessage(state: AppState, msg: HostMessage): AppState {
  switch (msg.type) {
    case 'host:init':
      return { ...state, filters: msg.filters };
    case 'host:projects':
      return { ...state, projects: msg.projects };
    case 'host:packageRows':
      return {
        ...state,
        rowsByProject: { ...state.rowsByProject, [msg.projectPath]: msg.rows },
      };
    case 'host:packageVersions':
      return {
        ...state,
        versionsByPackage: {
          ...state.versionsByPackage,
          [packageKey(msg.projectPath, msg.packageId)]: msg.versions,
        },
        // Update the row's newestAllowed if we got a fresher value.
        rowsByProject: updateRowNewest(state.rowsByProject, msg),
      };
    case 'host:status':
      return { ...state, status: msg.status };
    case 'host:error':
      return { ...state, error: { message: msg.message, detail: msg.detail } };
  }
}

function updateRowNewest(
  rowsByProject: AppState['rowsByProject'],
  msg: import('@nuget-compass/shared').HostPackageVersionsMessage,
): AppState['rowsByProject'] {
  const rows = rowsByProject[msg.projectPath];
  if (!rows) return rowsByProject;
  const updated = rows.map((r) =>
    r.package.id === msg.packageId ? { ...r, newestAllowed: msg.newestAllowed } : r,
  );
  return { ...rowsByProject, [msg.projectPath]: updated };
}
