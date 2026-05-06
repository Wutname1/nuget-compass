/**
 * A discovered .NET project (csproj/fsproj/vbproj) in the workspace.
 */
export interface Project {
  /** Absolute filesystem path to the project file. */
  path: string;
  /** Display name (file basename without extension). */
  name: string;
  /** Target framework monikers declared by the project. May be one or many. */
  targetFrameworks: string[];
  /** Top-level packages installed in the project. */
  packages: InstalledPackage[];
  /** Path to the governing Directory.Packages.props if CPM is active for this project. */
  centralPackageManagement?: { propsPath: string };
  /** Path to packages.lock.json if locked-restore is in use. */
  lockFilePath?: string;
}

/**
 * A package reference resolved from `dotnet package list --format json`.
 */
export interface InstalledPackage {
  /** Package id, e.g. "Microsoft.Extensions.Configuration". */
  id: string;
  /** The version requested in the csproj (may include floating notation like "8.*"). */
  requestedVersion: string;
  /** The version actually resolved by NuGet restore. */
  resolvedVersion: string;
  /** True if this is a transitive dependency rather than a top-level reference. */
  isTransitive: boolean;
}
