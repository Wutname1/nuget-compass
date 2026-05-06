/**
 * One available version of a package, with TFM compatibility resolved
 * against a specific project.
 */
export interface AvailableVersion {
  version: string;
  /** ISO-8601 publish date if known. */
  published?: string;
  /** TFMs declared in the package's dependencyGroups; empty if unknown. */
  supportedFrameworks: string[];
  /** True if this version targets at least one TFM compatible with the project. */
  isCompatible: boolean;
  /** True if the version string is a SemVer prerelease. */
  isPrerelease: boolean;
}

/**
 * Vulnerability info for an installed package, from `dotnet package list --vulnerable`.
 */
export interface VulnerabilityInfo {
  severity: 'Low' | 'Moderate' | 'High' | 'Critical';
  advisoryUrl: string;
}

/**
 * Deprecation info for an installed package, from `dotnet package list --deprecated`.
 */
export interface DeprecationInfo {
  /** Reasons reported by the package author, e.g. "Legacy", "CriticalBugs", "Other". */
  reasons: string[];
  message?: string;
  /** Suggested replacement package, if specified. */
  alternatePackage?: {
    id: string;
    versionRange: string;
  };
}

/**
 * Aggregated state for a single (project, package) pair as shown in the UI.
 */
export interface PackageRow {
  projectPath: string;
  package: import('./project.js').InstalledPackage;
  available?: AvailableVersion[];
  vulnerability?: VulnerabilityInfo[];
  deprecation?: DeprecationInfo;
  /** Newest version that passes the current filter set, if any. */
  newestAllowed?: string;
}
