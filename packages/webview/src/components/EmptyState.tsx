import { PackageIcon, WarningTriangle } from './icons.js';

/**
 * Empty / error state cards used when the workspace has no projects, the .NET
 * SDK is missing, or the active list has no rows. Each variant centers an
 * icon, a sentence-case title, and a sub-line of description.
 */
export function NoProjectsEmpty(): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ color: 'var(--nc-muted)' }}>
        <PackageIcon size={32} />
      </div>
      <p className="empty-title">No .NET projects found in this workspace.</p>
      <p className="empty-sub">
        Open a folder containing a <code>.csproj</code>, <code>.fsproj</code>, or{' '}
        <code>.vbproj</code> file.
      </p>
    </div>
  );
}

export function SdkMissingEmpty({
  onOpenLink,
}: {
  onOpenLink?: () => void;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ color: 'var(--nc-warn)' }}>
        <WarningTriangle size={32} />
      </div>
      <p className="empty-title">The .NET SDK was not found.</p>
      <p className="empty-sub">
        NuGet Compass needs <code>dotnet</code> 8.0+ on PATH.
      </p>
      {onOpenLink ? (
        <button type="button" className="empty-action" onClick={onOpenLink}>
          Get the .NET SDK
        </button>
      ) : null}
    </div>
  );
}

export function GenericEmpty({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ color: 'var(--nc-muted)' }}>
        <PackageIcon size={32} />
      </div>
      <p className="empty-title">{title}</p>
      {sub ? <p className="empty-sub">{sub}</p> : null}
    </div>
  );
}
