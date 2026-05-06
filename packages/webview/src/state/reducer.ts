import type { FilterState, HostMessage, PackageRow, Project } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';

export interface ProjectStatus {
  status: 'enriching' | 'ready';
  progress?: { done: number; total: number };
}

export interface ReadmeState {
  loading: boolean;
  body?: string;
  contentType?: 'markdown' | 'html' | 'error';
  errorMessage?: string;
}

export interface SearchHit {
  id: string;
  latestVersion: string;
  totalDownloads?: number;
  owners?: string;
  description?: string;
}

export interface SelectedPackage {
  projectPath: string;
  packageId: string;
  /** Optionally pre-pick a version to focus in the detail panel. */
  focusedVersion?: string;
}

export interface AppState {
  filters: FilterState;
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  /** Per-project enrichment progress, keyed by project path. */
  projectStatus: Record<string, ProjectStatus>;
  /** Versions returned from a host:packageVersions message, keyed by `${projectPath}::${packageId}`. */
  versionsByPackage: Record<string, import('@nuget-compass/shared').AvailableVersion[]>;
  /** Currently selected package; drives the detail panel. */
  selectedPackage?: SelectedPackage;
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
  search: { query: string; results: SearchHit[]; visible: boolean };
  sources: Array<{ name: string; url: string; enabled: boolean }>;
  /** README body keyed by `${packageId}@${version}`. */
  readmes: Record<string, ReadmeState>;
}

export const initialState: AppState = {
  filters: defaultFilterState,
  projects: [],
  rowsByProject: {},
  projectStatus: {},
  versionsByPackage: {},
  status: 'idle',
  search: { query: '', results: [], visible: false },
  sources: [],
  readmes: {},
};

export function readmeKey(packageId: string, version: string): string {
  return `${packageId}@${version}`;
}

export type Action =
  | { type: 'host'; message: HostMessage }
  | { type: 'setFilters'; filters: FilterState }
  | { type: 'selectPackage'; selection: SelectedPackage | undefined }
  | { type: 'toggleSearch' }
  | { type: 'setSearchQuery'; query: string }
  | { type: 'clearSearch' }
  | { type: 'readmeRequested'; packageId: string; version: string };

export function packageKey(projectPath: string, packageId: string): string {
  return `${projectPath}::${packageId}`;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setFilters':
      return { ...state, filters: action.filters };
    case 'selectPackage':
      return { ...state, selectedPackage: action.selection };
    case 'toggleSearch':
      return { ...state, search: { ...state.search, visible: !state.search.visible } };
    case 'setSearchQuery':
      return { ...state, search: { ...state.search, query: action.query } };
    case 'clearSearch':
      return { ...state, search: { ...state.search, query: '', results: [] } };
    case 'readmeRequested':
      return {
        ...state,
        readmes: {
          ...state.readmes,
          [readmeKey(action.packageId, action.version)]: { loading: true },
        },
      };
    case 'host':
      return applyHostMessage(state, action.message);
  }
}

function applyHostMessage(state: AppState, msg: HostMessage): AppState {
  switch (msg.type) {
    case 'host:init':
      return { ...state, filters: msg.filters };
    case 'host:projects': {
      // New scan: drop stale per-project status. Clear the selected package
      // if its project is no longer in the workspace.
      const stillExists = state.selectedPackage
        ? msg.projects.some((p) => p.path === state.selectedPackage!.projectPath)
        : false;
      return {
        ...state,
        projects: msg.projects,
        projectStatus: {},
        selectedPackage: stillExists ? state.selectedPackage : undefined,
      };
    }
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
    case 'host:sources':
      return { ...state, sources: msg.sources };
    case 'host:readme':
      return {
        ...state,
        readmes: {
          ...state.readmes,
          [readmeKey(msg.packageId, msg.version)]: {
            loading: false,
            body: msg.body,
            contentType: msg.contentType,
            errorMessage: msg.errorMessage,
          },
        },
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
