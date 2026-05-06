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

export type HostMessage =
  | HostInitMessage
  | HostProjectsMessage
  | HostPackageRowsMessage
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

export type ViewMessage =
  | ViewReadyMessage
  | ViewRefreshMessage
  | ViewSetFiltersMessage
  | ViewExpandPackageMessage
  | ViewUpdatePackageMessage;
