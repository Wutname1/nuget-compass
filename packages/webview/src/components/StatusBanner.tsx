interface StatusBannerProps {
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
}

export function StatusBanner({ status, error }: StatusBannerProps): JSX.Element | null {
  if (error) {
    return (
      <div className="banner banner-error" role="alert">
        <div>
          <strong>{error.message}</strong>
          {error.detail ? <pre className="banner-detail">{error.detail}</pre> : null}
        </div>
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
