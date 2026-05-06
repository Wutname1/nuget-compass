import { useState } from 'react';
import type { Project } from '@nuget-compass/shared';
import type { SearchHit } from '../state/reducer.js';
import { vscode } from '../vscode.js';

interface SearchPanelProps {
  projects: Project[];
  query: string;
  results: SearchHit[];
  onQueryChange: (query: string) => void;
}

export function SearchPanel({
  projects,
  query,
  results,
  onQueryChange,
}: SearchPanelProps): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<string>('');

  const submit = (): void => {
    if (query.trim().length === 0) return;
    vscode.postMessage({ type: 'view:searchPackages', query });
  };

  const targetProject =
    selectedProject || (projects[0]?.path ?? '');

  return (
    <div className="search-panel">
      <div className="search-input-row">
        <input
          type="search"
          className="search-input"
          placeholder="Search NuGet…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" className="search-button" onClick={submit}>
          Search
        </button>
      </div>
      {projects.length > 1 ? (
        <label className="search-target">
          <span>Install to:</span>
          <select
            value={targetProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {results.length > 0 ? (
        <ul className="search-results">
          {results.map((hit) => (
            <li key={hit.id} className="search-result">
              <div className="search-result-main">
                <span className="search-result-id">{hit.id}</span>
                <span className="search-result-version">{hit.latestVersion}</span>
              </div>
              {hit.description ? (
                <p className="search-result-description">{hit.description}</p>
              ) : null}
              <div className="search-result-meta">
                {hit.owners ? <span className="muted">by {hit.owners}</span> : null}
                {hit.totalDownloads !== undefined ? (
                  <span className="muted">
                    {formatDownloads(hit.totalDownloads)} downloads
                  </span>
                ) : null}
              </div>
              <div className="search-result-actions">
                <button
                  type="button"
                  className="package-action"
                  disabled={!targetProject}
                  onClick={() =>
                    vscode.postMessage({
                      type: 'view:installPackage',
                      projectPath: targetProject,
                      packageId: hit.id,
                    })
                  }
                >
                  Install
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
