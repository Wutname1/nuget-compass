import type {
  ActivityCategory,
  ActivityEntry,
  ActivityLevel,
  BulkProgressState,
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
export type AppTab = 'installed' | 'browse' | 'updates' | 'activity';

export interface ActivityFilters {
  levels: Record<ActivityLevel, boolean>;
  category: ActivityCategory | 'all';
}

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
  /** Streamed activity entries (capped client-side at 500). */
  activity: ActivityEntry[];
  activityFilters: ActivityFilters;
  /** Highest activity id seen while the Activity tab was active. */
  activityLastSeenId: number;
  /** Current bulk operation, if any; drives the progress modal. */
  bulkProgress?: BulkProgressState;
  /** Last completed bulk operation summary, kept until user dismisses it. */
  bulkResult?: {
    id: string;
    succeeded: number;
    failed: number;
    cancelled: boolean;
    aborted: boolean;
    /** Total items in the run (so we can show "10 of 13 skipped"). */
    total: number;
    /** Project label captured at completion time for the result modal. */
    projectName?: string;
  };
  /** When true, the progress modal is collapsed to a header pill. */
  bulkProgressMinimized: boolean;
}

const ACTIVITY_CAP = 500;

const defaultActivityFilters: ActivityFilters = {
  levels: { info: true, warn: true, error: true, debug: false },
  category: 'all',
};

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
  activity: [],
  activityFilters: defaultActivityFilters,
  activityLastSeenId: 0,
  bulkProgressMinimized: false,
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
  | { type: 'dismissFixResult'; key: string }
  | { type: 'setActivityLevel'; level: ActivityLevel; enabled: boolean }
  | { type: 'setActivityCategory'; category: ActivityCategory | 'all' }
  | { type: 'minimizeBulkProgress' }
  | { type: 'restoreBulkProgress' }
  | { type: 'dismissBulkResult' };

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
    case 'setTab': {
      const next: AppState = { ...state, tab: action.tab };
      if (action.tab === 'activity') {
        const last = state.activity[state.activity.length - 1];
        next.activityLastSeenId = last ? last.id : state.activityLastSeenId;
      }
      return next;
    }
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
    case 'setActivityLevel':
      return {
        ...state,
        activityFilters: {
          ...state.activityFilters,
          levels: { ...state.activityFilters.levels, [action.level]: action.enabled },
        },
      };
    case 'setActivityCategory':
      return {
        ...state,
        activityFilters: { ...state.activityFilters, category: action.category },
      };
    case 'minimizeBulkProgress':
      return { ...state, bulkProgressMinimized: true };
    case 'restoreBulkProgress':
      return { ...state, bulkProgressMinimized: false };
    case 'dismissBulkResult':
      return { ...state, bulkResult: undefined };
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
    case 'host:activity': {
      const merged = msg.replace ? msg.entries : appendActivity(state.activity, msg.entries);
      // If the user is currently on the Activity tab, treat new entries as seen
      // so the unread badge doesn't flash for entries they're already watching.
      const last = merged[merged.length - 1];
      const lastSeen =
        state.tab === 'activity' && last ? last.id : state.activityLastSeenId;
      // Replace messages (initial snapshot) shouldn't make a fresh user see every
      // historical entry as new — mark everything as already-seen.
      const initialSeen = msg.replace && last ? last.id : lastSeen;
      return { ...state, activity: merged, activityLastSeenId: initialSeen };
    }
    case 'host:activityCleared':
      return { ...state, activity: [], activityLastSeenId: 0 };
    case 'host:bulkProgress':
      return {
        ...state,
        bulkProgress: msg.state,
        // A new run un-minimizes itself so the user sees it.
        bulkProgressMinimized:
          state.bulkProgress?.id === msg.state.id ? state.bulkProgressMinimized : false,
        bulkResult: undefined,
      };
    case 'host:bulkCompleted': {
      const projectName = state.bulkProgress?.projectName;
      const total = state.bulkProgress?.total ?? msg.succeeded + msg.failed;
      return {
        ...state,
        bulkProgress: undefined,
        // Keep the modal mounted so the user always sees *why* the run
        // stopped. They close it explicitly; we never close it for them.
        // (Minimization is reset; once a run is done there's nothing to
        // minimize toward.)
        bulkProgressMinimized: false,
        bulkResult: {
          id: msg.id,
          succeeded: msg.succeeded,
          failed: msg.failed,
          cancelled: msg.cancelled,
          aborted: msg.aborted ?? false,
          projectName,
          total,
        },
      };
    }
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

function appendActivity(
  existing: ActivityEntry[],
  incoming: ActivityEntry[],
): ActivityEntry[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((e) => e.id));
  const merged = existing.slice();
  for (const e of incoming) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(e);
  }
  if (merged.length > ACTIVITY_CAP) merged.splice(0, merged.length - ACTIVITY_CAP);
  return merged;
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
