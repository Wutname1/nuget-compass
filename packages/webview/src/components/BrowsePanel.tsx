import { useEffect, useRef } from 'react';
import type { Project } from '@nuget-compass/shared';
import type { SearchHit } from '../state/reducer.js';
import { vscode } from '../vscode.js';
import { GenericEmpty } from './EmptyState.js';

interface BrowsePanelProps {
  projects: Project[];
  query: string;
  results: SearchHit[];
  includePrerelease: boolean;
  selectedHitId: string | undefined;
  onSelectHit: (hit: SearchHit) => void;
}

/**
 * Browse-the-feed view. Wraps the existing search backend with the new
 * design-system row treatment. Selecting a result surfaces it in the detail
 * panel (description / versions / add-to-projects).
 */
export function BrowsePanel({
  projects,
  query,
  results,
  includePrerelease,
  selectedHitId,
  onSelectHit,
}: BrowsePanelProps): JSX.Element {
  const lastSearchedQuery = useRef('');

  // Re-issue the search when the prerelease filter flips and a query is active.
  useEffect(() => {
    if (lastSearchedQuery.current.length > 0 && lastSearchedQuery.current === query) {
      vscode.postMessage({ type: 'view:searchPackages', query });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includePrerelease]);

  // Track whether we've ever issued a search so we can show an "empty" message.
  const hasSearched = lastSearchedQuery.current.length > 0;

  if (!hasSearched && query.trim().length === 0 && results.length === 0) {
    return (
      <GenericEmpty
        title="Search nuget.org"
        sub={
          projects.length === 0
            ? 'Open a workspace with a .NET project first to add packages.'
            : 'Type a package id or keyword in the search bar above to begin.'
        }
      />
    );
  }

  if (hasSearched && results.length === 0) {
    return <GenericEmpty title="No packages match that query." />;
  }

  return (
    <div>
      {results.map((hit) => (
        <BrowseResult
          key={hit.id}
          hit={hit}
          selected={selectedHitId === hit.id}
          onSelect={() => {
            onSelectHit(hit);
          }}
          onAdd={() => {
            const target = projects[0]?.path;
            if (!target) return;
            vscode.postMessage({
              type: 'view:installPackage',
              projectPath: target,
              packageId: hit.id,
            });
          }}
          canAdd={projects.length > 0}
        />
      ))}
    </div>
  );
}

function BrowseResult({
  hit,
  selected,
  onSelect,
  onAdd,
  canAdd,
}: {
  hit: SearchHit;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
  canAdd: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={'browse-result' + (selected ? ' browse-result-selected' : '')}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="browse-result-main">
        <span className="browse-result-head">
          <span className="browse-result-id">{hit.id}</span>
          <span className="browse-result-version">{hit.latestVersion}</span>
          {hit.totalDownloads !== undefined ? (
            <span className="browse-result-downloads">
              {formatDownloads(hit.totalDownloads)} dl
            </span>
          ) : null}
        </span>
        {hit.description ? (
          <span className="browse-result-desc">{hit.description}</span>
        ) : null}
      </span>
      <span>
        <button
          type="button"
          className="browse-add-button"
          disabled={!canAdd}
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          + Add
        </button>
      </span>
    </button>
  );
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
