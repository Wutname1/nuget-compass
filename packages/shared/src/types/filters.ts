export type UpdateLevel = 'patch' | 'minor' | 'major';
export type TfmFilter = 'compatible' | 'all';

export interface FilterState {
  tfm: TfmFilter;
  updateLevel: UpdateLevel;
  includePrerelease: boolean;
  showTransitive: boolean;
}

export const defaultFilterState: FilterState = {
  tfm: 'compatible',
  updateLevel: 'minor',
  includePrerelease: false,
  showTransitive: false,
};
