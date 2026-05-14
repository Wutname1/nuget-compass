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
    return (
      <div className="banner banner-error" role="alert">
        <div className="banner-body">
          <strong>{error.message}</strong>
          {error.detail ? <pre className="banner-detail">{error.detail}</pre> : null}
        </div>
        {onOpenActivity ? (
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
