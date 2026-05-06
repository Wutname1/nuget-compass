/**
 * Inline SVG icon components used throughout the UI. They follow VS Code's
 * codicon style: 24x24 viewBox, currentColor stroke, no fills unless noted.
 */

export function CompassIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polygon points="16,8 13,13 8,16 11,11" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SearchIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function PackageIcon({ size = 32 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );
}

export function WarningTriangle({ size = 32 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function ListIcon({ size = 10 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="3" width="12" height="2" />
      <rect x="2" y="7" width="12" height="2" />
      <rect x="2" y="11" width="12" height="2" />
    </svg>
  );
}

export function FolderIcon({ size = 10 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M2 4h5l1 1h6v8H2z" />
    </svg>
  );
}

/**
 * Official NuGet brand mark (square + dot). Inlined so the webview doesn't
 * have to load an external SVG. Uses NuGet blue (#004880) by default.
 */
export function NuGetLogo({
  size = 14,
  color = '#004880',
}: {
  size?: number;
  color?: string;
}): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path
        fill={color}
        d="M374.4 454.9c-46.7 0-84.6-37.9-84.6-84.7s37.9-84.7 84.6-84.7 84.6 37.9 84.6 84.7-37.9 84.7-84.6 84.7zM205.6 260.8c-29.2 0-52.9-23.7-52.9-52.9s23.7-52.9 52.9-52.9 52.9 23.7 52.9 52.9-23.7 52.9-52.9 52.9zM378.2 95.6H236.9C164.9 95.6 106.5 154.1 106.5 226.1v141.3c0 72 58.4 130.4 130.4 130.4h141.3c72 0 130.4-58.4 130.4-130.4V226.1c0-72-58.4-130.4-130.4-130.4z"
      />
      <path
        fill={color}
        d="M84.7 52C84.7 75.4 65.7 94.3 42.3 94.3 19 94.3 0 75.4 0 52 0 28.6 18.9 9.7 42.3 9.7c23.4 0 42.4 18.9 42.4 42.3z"
      />
    </svg>
  );
}

export function LockIcon({ size = 10 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
