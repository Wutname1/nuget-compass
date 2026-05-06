interface StatusBannerProps {
  status: 'idle' | 'scanning' | 'fetching';
  error?: { message: string; detail?: string };
}

export function StatusBanner({ status, error }: StatusBannerProps): JSX.Element | null {
  if (error) {
    return (
      <div className="banner banner-error" role="alert">
        <strong>{error.message}</strong>
        {error.detail ? <pre className="banner-detail">{error.detail}</pre> : null}
      </div>
    );
  }
  if (status === 'scanning') {
    return (
      <div className="banner banner-info" role="status">
        Scanning .NET projects…
      </div>
    );
  }
  if (status === 'fetching') {
    return (
      <div className="banner banner-info" role="status">
        Fetching versions…
      </div>
    );
  }
  return null;
}
