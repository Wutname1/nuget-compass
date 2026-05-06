/**
 * IPC message contracts between the extension host and the webview.
 *
 * Naming: `Host*` flows host → webview. `View*` flows webview → host.
 * Every message has a discriminator on `type`. Add cases to the unions, never
 * to the individual interfaces — keeps the discriminated union exhaustive.
 */

import type { Project } from './project.js';
import type { PackageRow } from './package.js';
import type { FilterState } from './filters.js';

// ── Host → Webview ──────────────────────────────────────────────────────────

export interface HostInitMessage {
  type: 'host:init';
  filters: FilterState;
  fontScale: number;
}

export interface HostFontScaleMessage {
  type: 'host:fontScale';
  fontScale: number;
}

export interface HostProjectsMessage {
  type: 'host:projects';
  projects: Project[];
}

export interface HostPackageRowsMessage {
  type: 'host:packageRows';
  /** Replaces the rows for the given project. */
  projectPath: string;
  rows: PackageRow[];
}

export interface HostErrorMessage {
  type: 'host:error';
  message: string;
  detail?: string;
}

export interface HostStatusMessage {
  type: 'host:status';
  status: 'idle' | 'scanning' | 'fetching';
}

export interface HostProjectStatusMessage {
  type: 'host:projectStatus';
  projectPath: string;
  /** 'enriching' = catalog/vuln/deprec scans in flight; 'ready' = all data present. */
  status: 'enriching' | 'ready';
  /** Optional progress hint, e.g. "12/40 packages". */
  progress?: { done: number; total: number };
}

export interface HostPackageVersionsMessage {
  type: 'host:packageVersions';
  projectPath: string;
  packageId: string;
  versions: import('./package.js').AvailableVersion[];
  /** Newest version that passes current filters at the moment of resolution. */
  newestAllowed?: string;
}

export interface HostSearchResultsMessage {
  type: 'host:searchResults';
  query: string;
  results: Array<{
    id: string;
    latestVersion: string;
    totalDownloads?: number;
    owners?: string;
    description?: string;
  }>;
}

export interface HostSourcesMessage {
  type: 'host:sources';
  sources: Array<{ name: string; url: string; enabled: boolean }>;
}

export interface HostReadmeMessage {
  type: 'host:readme';
  packageId: string;
  version: string;
  /** Markdown content if we fetched it; HTML if NuGet served HTML; empty string on failure. */
  body: string;
  contentType: 'markdown' | 'html' | 'error';
  errorMessage?: string;
}

export type HostMessage =
  | HostInitMessage
  | HostFontScaleMessage
  | HostProjectsMessage
  | HostPackageRowsMessage
  | HostPackageVersionsMessage
  | HostProjectStatusMessage
  | HostSearchResultsMessage
  | HostSourcesMessage
  | HostReadmeMessage
  | HostErrorMessage
  | HostStatusMessage;

// ── Webview → Host ──────────────────────────────────────────────────────────

export interface ViewReadyMessage {
  type: 'view:ready';
}

export interface ViewRefreshMessage {
  type: 'view:refresh';
  forceCacheBust?: boolean;
}

export interface ViewSetFiltersMessage {
  type: 'view:setFilters';
  filters: FilterState;
}

export interface ViewExpandPackageMessage {
  type: 'view:expandPackage';
  projectPath: string;
  packageId: string;
}

export interface ViewUpdatePackageMessage {
  type: 'view:updatePackage';
  projectPath: string;
  packageId: string;
  toVersion: string;
}

export interface ViewUpdateAllMessage {
  type: 'view:updateAll';
  projectPath: string;
}

export interface ViewUninstallPackageMessage {
  type: 'view:uninstallPackage';
  projectPath: string;
  packageId: string;
}

export interface ViewSearchPackagesMessage {
  type: 'view:searchPackages';
  query: string;
}

export interface ViewInstallPackageMessage {
  type: 'view:installPackage';
  projectPath: string;
  packageId: string;
  /** Omitted = let the SDK pick the latest compatible. */
  version?: string;
}

export interface ViewAddSourceMessage {
  type: 'view:addSource';
  name: string;
  url: string;
  username?: string;
  password?: string;
}

export interface ViewRemoveSourceMessage {
  type: 'view:removeSource';
  name: string;
}

export interface ViewToggleSourceMessage {
  type: 'view:toggleSource';
  name: string;
  enabled: boolean;
}

export interface ViewFetchReadmeMessage {
  type: 'view:fetchReadme';
  packageId: string;
  version: string;
  /** URL pulled from the catalog. */
  readmeUrl: string;
}

export type ViewMessage =
  | ViewReadyMessage
  | ViewRefreshMessage
  | ViewSetFiltersMessage
  | ViewExpandPackageMessage
  | ViewUpdatePackageMessage
  | ViewUpdateAllMessage
  | ViewUninstallPackageMessage
  | ViewSearchPackagesMessage
  | ViewInstallPackageMessage
  | ViewAddSourceMessage
  | ViewRemoveSourceMessage
  | ViewToggleSourceMessage
  | ViewFetchReadmeMessage;
