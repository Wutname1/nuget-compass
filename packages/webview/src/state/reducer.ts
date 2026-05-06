import type { FilterState, HostMessage, PackageRow, Project } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';

export interface AppState {
  filters: FilterState;
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
}

export const initialState: AppState = {
  filters: defaultFilterState,
  projects: [],
  rowsByProject: {},
  status: 'idle',
};

export type Action =
  | { type: 'host'; message: HostMessage }
  | { type: 'setFilters'; filters: FilterState };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setFilters':
      return { ...state, filters: action.filters };
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
    case 'host:status':
      return { ...state, status: msg.status };
    case 'host:error':
      return { ...state, error: { message: msg.message, detail: msg.detail } };
  }
}
