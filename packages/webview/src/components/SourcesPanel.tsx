import { useState } from 'react';
import { vscode } from '../vscode.js';

interface Source {
  name: string;
  url: string;
  enabled: boolean;
}

interface SourcesPanelProps {
  sources: Source[];
}

/**
 * Footer panel for managing NuGet sources from `nuget.config`. Backed by
 * `dotnet nuget add/remove/enable/disable source` (see view:addSource etc.).
 */
export function SourcesPanel({ sources }: SourcesPanelProps): JSX.Element | null {
  const [showAddForm, setShowAddForm] = useState(false);

  if (sources.length === 0) return null;

  const activeCount = sources.filter((s) => s.enabled).length;

  return (
    <details className="sources-footer">
      <summary>
        <span className="muted">
          Configured sources ({activeCount} active, {sources.length} total)
        </span>
      </summary>
      <ul className="sources-list">
        {sources.map((src) => (
          <SourceRow key={src.name} source={src} />
        ))}
      </ul>
      <div className="sources-actions">
        {showAddForm ? (
          <AddSourceForm onClose={() => setShowAddForm(false)} />
        ) : (
          <button
            type="button"
            className="package-action"
            onClick={() => setShowAddForm(true)}
          >
            Add source
          </button>
        )}
      </div>
    </details>
  );
}

function SourceRow({ source }: { source: Source }): JSX.Element {
  return (
    <li className={source.enabled ? '' : 'source-disabled'}>
      <div className="source-row-main">
        <span className="source-name">{source.name}</span>
        <span className="muted source-url">{source.url}</span>
        {!source.enabled ? <span className="badge badge-source-off">disabled</span> : null}
      </div>
      <div className="source-row-actions">
        <button
          type="button"
          className="package-action"
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
          className="package-action package-action-danger"
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

function AddSourceForm({ onClose }: { onClose: () => void }): JSX.Element {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showCreds, setShowCreds] = useState(false);

  const submit = (): void => {
    if (name.trim().length === 0 || url.trim().length === 0) return;
    vscode.postMessage({
      type: 'view:addSource',
      name: name.trim(),
      url: url.trim(),
      username: username.trim() || undefined,
      password: password.length > 0 ? password : undefined,
    });
    onClose();
  };

  return (
    <div className="add-source-form">
      <label className="add-source-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="MyFeed"
        />
      </label>
      <label className="add-source-field">
        <span>URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/v3/index.json"
        />
      </label>
      <label className="add-source-credentials-toggle">
        <input
          type="checkbox"
          checked={showCreds}
          onChange={(e) => setShowCreds(e.target.checked)}
        />
        <span>Authenticated feed</span>
      </label>
      {showCreds ? (
        <>
          <label className="add-source-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="add-source-field">
            <span>Password / token</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p className="muted small">
            Stored in clear text in your nuget.config. For Azure DevOps and similar feeds,
            use a personal access token.
          </p>
        </>
      ) : null}
      <div className="add-source-buttons">
        <button type="button" className="project-action" onClick={submit}>
          Add
        </button>
        <button type="button" className="package-action" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
