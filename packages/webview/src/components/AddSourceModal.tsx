import { useEffect, useState } from 'react';
import { vscode } from '../vscode.js';

type FeedType = 'generic' | 'github' | 'azure-devops' | 'nuget-org';
type CredentialStore = 'nuget-config' | 'vscode-secrets';

interface AddSourceModalProps {
  /** When set, the modal is in re-auth mode for an existing source. */
  reauthFor?: {
    name: string;
    url: string;
    credentialStore?: 'nuget-config' | 'vscode-secrets' | 'none';
  };
  onClose: () => void;
}

const FEED_PRESETS: Record<
  FeedType,
  { label: string; urlHint: string; credLabel: string; help: string }
> = {
  generic: {
    label: 'Generic NuGet feed',
    urlHint: 'https://example.com/v3/index.json',
    credLabel: 'Password / token',
    help: 'Username and password or API key, depending on what your feed accepts.',
  },
  github: {
    label: 'GitHub Packages',
    urlHint: 'https://nuget.pkg.github.com/<owner>/index.json',
    credLabel: 'Personal access token (PAT)',
    help: 'Use a GitHub PAT with the `read:packages` scope. Username is your GitHub login.',
  },
  'azure-devops': {
    label: 'Azure DevOps Artifacts',
    urlHint: 'https://pkgs.dev.azure.com/<org>/_packaging/<feed>/nuget/v3/index.json',
    credLabel: 'Personal access token (PAT)',
    help: 'Use an Azure DevOps PAT with Packaging (read) scope. Username can be anything.',
  },
  'nuget-org': {
    label: 'nuget.org (public)',
    urlHint: 'https://api.nuget.org/v3/index.json',
    credLabel: 'API key',
    help: 'Public packages need no credentials. Only set an API key if you have a private mirror.',
  },
};

export function AddSourceModal({ reauthFor, onClose }: AddSourceModalProps): React.JSX.Element {
  const isReauth = Boolean(reauthFor);

  const [feedType, setFeedType] = useState<FeedType>('generic');
  const [name, setName] = useState(reauthFor?.name ?? '');
  const [url, setUrl] = useState(reauthFor?.url ?? '');
  const [needsAuth, setNeedsAuth] = useState(isReauth);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [credentialStore, setCredentialStore] = useState<CredentialStore>(
    reauthFor?.credentialStore === 'vscode-secrets' ? 'vscode-secrets' : 'nuget-config',
  );

  // Close on Escape — matches ConfirmUpdateModal behavior expected by users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preset = FEED_PRESETS[feedType];
  const canSubmit =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (!needsAuth || password.length > 0);

  const submit = (): void => {
    if (!canSubmit) return;
    vscode.postMessage({
      type: 'view:addSource',
      name: name.trim(),
      url: url.trim(),
      username: needsAuth && username.trim().length > 0 ? username.trim() : undefined,
      password: needsAuth && password.length > 0 ? password : undefined,
      credentialStore: needsAuth ? credentialStore : undefined,
      reauth: isReauth ? true : undefined,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-source-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-title" id="add-source-title">
          {isReauth ? `Re-authenticate "${reauthFor?.name}"` : 'Add NuGet source'}
        </p>
        <div className="modal-body">
          {!isReauth ? (
            <label className="add-source-field">
              <span>Feed type</span>
              <select
                value={feedType}
                onChange={(e) => setFeedType(e.target.value as FeedType)}
              >
                {(Object.keys(FEED_PRESETS) as FeedType[]).map((t) => (
                  <option key={t} value={t}>
                    {FEED_PRESETS[t].label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="add-source-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MyFeed"
              disabled={isReauth}
            />
          </label>

          <label className="add-source-field">
            <span>URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={preset.urlHint}
              disabled={isReauth}
            />
          </label>

          {!isReauth ? (
            <label className="add-source-credentials-toggle">
              <input
                type="checkbox"
                checked={needsAuth}
                onChange={(e) => setNeedsAuth(e.target.checked)}
              />
              <span>Authenticated feed</span>
            </label>
          ) : null}

          {needsAuth ? (
            <>
              <label className="add-source-field">
                <span>Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="add-source-field">
                <span>{preset.credLabel}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <p className="muted small">{preset.help}</p>

              <fieldset className="add-source-storage">
                <legend>Where to store the credentials</legend>
                <label className="add-source-storage-option">
                  <input
                    type="radio"
                    name="credentialStore"
                    value="nuget-config"
                    checked={credentialStore === 'nuget-config'}
                    onChange={() => setCredentialStore('nuget-config')}
                  />
                  <span>
                    <strong>nuget.config</strong>
                    <span className="muted small">
                      Shared with all .NET tools. Saved in clear text.
                    </span>
                  </span>
                </label>
                <label className="add-source-storage-option">
                  <input
                    type="radio"
                    name="credentialStore"
                    value="vscode-secrets"
                    checked={credentialStore === 'vscode-secrets'}
                    onChange={() => setCredentialStore('vscode-secrets')}
                  />
                  <span>
                    <strong>VS Code only</strong>
                    <span className="muted small">
                      Stored encrypted in VS Code SecretStorage. Used only by this extension.
                    </span>
                  </span>
                </label>
              </fieldset>
            </>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {isReauth ? 'Update credentials' : 'Add source'}
          </button>
        </div>
      </div>
    </div>
  );
}
