import { useState } from 'react';
import { vscode } from '../vscode.js';
import { AddSourceModal } from './AddSourceModal.js';

interface Source {
  name: string;
  url: string;
  enabled: boolean;
  credentialStore?: 'nuget-config' | 'vscode-secrets' | 'none';
  authFailed?: boolean;
}

interface SourcesPanelProps {
  sources: Source[];
}

/**
 * Footer panel for managing NuGet sources from `nuget.config`. Backed by
 * `dotnet nuget add/remove/enable/disable source` (see view:addSource etc.).
 *
 * Sources stored with credentialStore="vscode-secrets" keep their secret in
 * VS Code's SecretStorage and are injected into dotnet at scan time via
 * NuGetPackageSourceCredentials_<NAME> env vars.
 */
export function SourcesPanel({ sources }: SourcesPanelProps): JSX.Element | null {
  const [showAddModal, setShowAddModal] = useState(false);
  const [reauthFor, setReauthFor] = useState<Source | undefined>(undefined);

  if (sources.length === 0 && !showAddModal && !reauthFor) return null;

  const activeCount = sources.filter((s) => s.enabled).length;
  const failingCount = sources.filter((s) => s.authFailed).length;

  return (
    <>
      <details className="sources-footer" open={failingCount > 0}>
        <summary>
          <span className="muted">
            Configured sources ({activeCount} active, {sources.length} total)
            {failingCount > 0 ? (
              <span className="badge badge-source-off"> {failingCount} auth issue{failingCount === 1 ? '' : 's'}</span>
            ) : null}
          </span>
        </summary>
        <ul className="sources-list">
          {sources.map((src) => (
            <SourceRow key={src.name} source={src} onReauth={() => setReauthFor(src)} />
          ))}
        </ul>
        <div className="sources-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowAddModal(true)}
          >
            Add source
          </button>
        </div>
      </details>

      {showAddModal ? <AddSourceModal onClose={() => setShowAddModal(false)} /> : null}
      {reauthFor ? (
        <AddSourceModal
          reauthFor={{
            name: reauthFor.name,
            url: reauthFor.url,
            credentialStore: reauthFor.credentialStore,
          }}
          onClose={() => setReauthFor(undefined)}
        />
      ) : null}
    </>
  );
}

function SourceRow({
  source,
  onReauth,
}: {
  source: Source;
  onReauth: () => void;
}): JSX.Element {
  return (
    <li className={source.enabled ? '' : 'source-disabled'}>
      <div className="source-row-main">
        <span className="source-name">{source.name}</span>
        <span className="muted source-url">{source.url}</span>
        {!source.enabled ? <span className="badge badge-source-off">disabled</span> : null}
        {source.credentialStore === 'vscode-secrets' ? (
          <span className="badge badge-source-store" title="Credentials stored in VS Code SecretStorage">
            vs code creds
          </span>
        ) : null}
        {source.authFailed ? (
          <span className="badge badge-source-auth" title="Last scan failed authentication">
            auth failed
          </span>
        ) : null}
      </div>
      <div className="source-row-actions">
        {source.authFailed || source.credentialStore === 'vscode-secrets' ? (
          <button type="button" className="btn-secondary" onClick={onReauth}>
            Re-authenticate
          </button>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            vscode.postMessage({
              type: 'view:toggleSource',
              name: source.name,
              enabled: !source.enabled,
            })
          }
        >
          {source.enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-secondary-danger"
          onClick={() =>
            vscode.postMessage({ type: 'view:removeSource', name: source.name })
          }
        >
          Remove
        </button>
      </div>
    </li>
  );
}
