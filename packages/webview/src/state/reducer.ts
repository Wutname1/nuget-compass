import type { FilterState, HostMessage, PackageRow, Project } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';

export interface ProjectStatus {
  status: 'enriching' | 'ready';
  progress?: { done: number; total: number };
}

export interface SearchHit {
  id: string;
  latestVersion: string;
  totalDownloads?: number;
  owners?: string;
  description?: string;
}

export interface AppState {
  filters: FilterState;
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  /** Per-project enrichment progress, keyed by project path. */
  projectStatus: Record<string, ProjectStatus>;
  /** Versions returned from a host:packageVersions message, keyed by `${projectPath}::${packageId}`. */
  versionsByPackage: Record<string, import('@nuget-compass/shared').AvailableVersion[]>;
  /** Which packages are expanded in the UI. Same key shape as versionsByPackage. */
  expanded: Record<string, true>;
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
  search: { query: string; results: SearchHit[]; visible: boolean };
}

export const initialState: AppState = {
  filters: defaultFilterState,
  projects: [],
  rowsByProject: {},
  projectStatus: {},
  versionsByPackage: {},
  expanded: {},
  status: 'idle',
  search: { query: '', results: [], visible: false },
};

export type Action =
  | { type: 'host'; message: HostMessage }
  | { type: 'setFilters'; filters: FilterState }
  | { type: 'toggleExpanded'; projectPath: string; packageId: string }
  | { type: 'toggleSearch' }
  | { type: 'setSearchQuery'; query: string };

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
    case 'toggleSearch':
      return { ...state, search: { ...state.search, visible: !state.search.visible } };
    case 'setSearchQuery':
      return { ...state, search: { ...state.search, query: action.query } };
    case 'host':
      return applyHostMessage(state, action.message);
  }
}

function applyHostMessage(state: AppState, msg: HostMessage): AppState {
  switch (msg.type) {
    case 'host:init':
      return { ...state, filters: msg.filters };
    case 'host:projects':
      // New scan: drop stale per-project status.
      return { ...state, projects: msg.projects, projectStatus: {} };
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
    case 'host:projectStatus':
      return {
        ...state,
        projectStatus: {
          ...state.projectStatus,
          [msg.projectPath]: { status: msg.status, progress: msg.progress },
        },
      };
    case 'host:searchResults':
      return { ...state, search: { ...state.search, query: msg.query, results: msg.results } };
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
