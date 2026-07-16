interface StatusBannerProps {
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
  onOpenActivity?: () => void;
  /**
   * True when cached project rows are already on screen and the active scan
   * is just refreshing them. Changes the banner copy from "Scanning…" to
   * "Checking for updates…" so the user understands they are looking at
   * cached data, not waiting for the first paint.
   */
  cachedRowsVisible?: boolean;
}

export function StatusBanner({
  status,
  error,
  onOpenActivity,
  cachedRowsVisible,
}: StatusBannerProps): React.JSX.Element | null {
  if (error) {
    // Strip our own "Open the Activity tab for details." trailer if present so
    // we can replace it with a real button instead of static text.
    const rawMessage = error.message;
    const cleanedMessage = rawMessage.replace(
      /\.?\s*Open the Activity tab for details\.?\s*$/i,
      '.',
    );
    const referencesActivity = cleanedMessage !== rawMessage;
    return (
      <div className="banner banner-error" role="alert">
        <div className="banner-body">
          <strong>{cleanedMessage}</strong>
          {(referencesActivity || error.detail) && onOpenActivity ? (
            <div className="banner-cta">
              <button
                type="button"
                className="banner-link"
                onClick={onOpenActivity}
              >
                Open Activity log →
              </button>
            </div>
          ) : null}
          {error.detail ? <pre className="banner-detail">{error.detail}</pre> : null}
        </div>
        {onOpenActivity && !referencesActivity ? (
          <button
            type="button"
            className="btn-secondary banner-action"
            onClick={onOpenActivity}
            title="Show full activity log"
          >
            Open Activity
          </button>
        ) : null}
      </div>
    );
  }
  if (status === 'scanning' || status === 'fetching') {
    const label = cachedRowsVisible
      ? 'Checking for new updates…'
      : status === 'scanning'
        ? 'Scanning .NET projects…'
        : 'Fetching versions…';
    return (
      <div className="banner banner-info" role="status">
        <span className="banner-spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    );
  }
  return null;
}
