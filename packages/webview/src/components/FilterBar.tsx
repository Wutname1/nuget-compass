import type { FilterState, TfmFilter, UpdateLevel } from '@nuget-compass/shared';

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps): JSX.Element {
  return (
    <div className="filter-bar">
      <label className="filter-label">
        <span>Target Framework:</span>
        <select
          value={filters.tfm}
          onChange={(e) => onChange({ ...filters, tfm: e.target.value as TfmFilter })}
        >
          <option value="compatible">Compatible only</option>
          <option value="all">Show all</option>
        </select>
      </label>

      <label className="filter-label">
        <span>Update:</span>
        <select
          value={filters.updateLevel}
          onChange={(e) => onChange({ ...filters, updateLevel: e.target.value as UpdateLevel })}
        >
          <option value="patch">Patch only</option>
          <option value="minor">Minor allowed</option>
          <option value="major">Major allowed</option>
        </select>
      </label>

      <label className="filter-label-checkbox">
        <input
          type="checkbox"
          checked={filters.includePrerelease}
          onChange={(e) => onChange({ ...filters, includePrerelease: e.target.checked })}
        />
        <span>Prerelease</span>
      </label>

      <label className="filter-label-checkbox">
        <input
          type="checkbox"
          checked={filters.showTransitive}
          onChange={(e) => onChange({ ...filters, showTransitive: e.target.checked })}
        />
        <span>Show transitive</span>
      </label>
    </div>
  );
}
