interface StatusBannerProps {
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
  onOpenActivity?: () => void;
}

export function StatusBanner({
  status,
  error,
  onOpenActivity,
}: StatusBannerProps): JSX.Element | null {
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
  if (status === 'scanning') {
    return (
      <div className="banner banner-info" role="status">
        <span className="banner-spinner" aria-hidden="true" />
        <span>Scanning .NET projects&hellip;</span>
      </div>
    );
  }
  if (status === 'fetching') {
    return (
      <div className="banner banner-info" role="status">
        <span className="banner-spinner" aria-hidden="true" />
        <span>Fetching versions&hellip;</span>
      </div>
    );
  }
  return null;
}
