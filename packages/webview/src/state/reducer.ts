import type {
  Diagnostic,
  FilterState,
  HostMessage,
  PackageRow,
  Project,
} from '@nuget-compass/shared';
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

/** Top-level tab in the panel. */
export type AppTab = 'installed' | 'browse' | 'updates';

/** How the Installed list is grouped. */
export type GroupBy = 'package' | 'project';

/** Toast surfaced after an async operation (update/install/etc.). */
export interface Toast {
  id: number;
  kind: 'success' | 'info';
  message: string;
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
  sources: Array<{
    name: string;
    url: string;
    enabled: boolean;
    credentialStore?: 'nuget-config' | 'vscode-secrets' | 'none';
    authFailed?: boolean;
  }>;
  /** Pending re-auth prompt triggered by host:sourceAuthRequired. */
  authPrompt?: {
    name: string;
    url: string;
    credentialStore?: 'nuget-config' | 'vscode-secrets' | 'none';
  };
  /** README body keyed by `${packageId}@${version}`. */
  readmes: Record<string, ReadmeState>;
  /** Active top-level tab: Installed / Browse / Updates. */
  tab: AppTab;
  /** Grouping strategy for the Installed tab. */
  groupBy: GroupBy;
  /** Free-text filter applied to package ids in Installed/Updates lists. */
  filterQuery: string;
  /** Most recent toast (auto-dismissed by the App). */
  toast?: Toast;
  /** Structured NuGet diagnostics from the most recent scan. */
  diagnostics: Diagnostic[];
  /** NU-codes the user has chosen to suppress in this workspace. */
  suppressedCodes: string[];
  /** Fix keys currently being applied (host:fixResult clears them). */
  fixesInFlight: Record<string, true>;
  /** Last fix result keyed by diagnostic key — used to show inline feedback. */
  fixResults: Record<
    string,
    {
      success: boolean;
      message: string;
      manualIntervention?: { reason: string; projects: string[]; packageIds: string[] };
    }
  >;
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
  tab: 'installed',
  groupBy: 'package',
  filterQuery: '',
  diagnostics: [],
  suppressedCodes: [],
  fixesInFlight: {},
  fixResults: {},
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
  | { type: 'readmeRequested'; packageId: string; version: string }
  | { type: 'setTab'; tab: AppTab }
  | { type: 'setGroupBy'; groupBy: GroupBy }
  | { type: 'setFilterQuery'; query: string }
  | { type: 'showToast'; toast: Toast }
  | { type: 'dismissToast' }
  | { type: 'dismissAuthPrompt' }
  | { type: 'fixStarted'; key: string }
  | { type: 'dismissFixResult'; key: string };

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
    case 'setTab':
      return { ...state, tab: action.tab };
    case 'setGroupBy':
      return { ...state, groupBy: action.groupBy };
    case 'setFilterQuery':
      return { ...state, filterQuery: action.query };
    case 'showToast':
      return { ...state, toast: action.toast };
    case 'dismissToast':
      return { ...state, toast: undefined };
    case 'dismissAuthPrompt':
      return { ...state, authPrompt: undefined };
    case 'fixStarted':
      return {
        ...state,
        fixesInFlight: { ...state.fixesInFlight, [action.key]: true },
      };
    case 'dismissFixResult': {
      const next = { ...state.fixResults };
      delete next[action.key];
      return { ...state, fixResults: next };
    }
    case 'host':
      return applyHostMessage(state, action.message);
  }
}

function applyHostMessage(state: AppState, msg: HostMessage): AppState {
  switch (msg.type) {
    case 'host:init':
      return { ...state, filters: msg.filters };
    case 'host:fontScale':
      return state;
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
    case 'host:sourceAuthRequired':
      return {
        ...state,
        authPrompt: {
          name: msg.name,
          url: msg.url,
          credentialStore: msg.credentialStore,
        },
      };
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
    case 'host:diagnostics':
      return {
        ...state,
        diagnostics: msg.diagnostics,
        suppressedCodes: msg.suppressedCodes,
        // Fresh scan invalidates stale fix results from the previous scan.
        fixResults: {},
        fixesInFlight: {},
        // A clean diagnostics list also clears any legacy error blob so the
        // banner doesn't keep yelling about errors that no longer exist.
        error: msg.diagnostics.length === 0 ? undefined : state.error,
      };
    case 'host:fixResult': {
      const inFlight = { ...state.fixesInFlight };
      delete inFlight[msg.key];
      return {
        ...state,
        fixesInFlight: inFlight,
        fixResults: {
          ...state.fixResults,
          [msg.key]: {
            success: msg.success,
            message: msg.message,
            manualIntervention: msg.manualIntervention,
          },
        },
      };
    }
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
