/**
 * Target Framework compatibility resolver.
 *
 * NuGet's official compatibility logic is in NuGet.Frameworks (C#), spanning
 * hundreds of monikers and a partial-order graph. We don't reimplement all of
 * it - the audience is modern SDK-style .NET projects on netN.0 / netstandard.
 *
 * Strategy:
 *   1. Normalize the input strings (catalog uses both "net8.0" and
 *      ".NETFramework4.6.2" forms).
 *   2. Reduce each TFM to a (family, major, minor, platform?) tuple.
 *   3. Apply the family-specific compatibility rule.
 *
 * Rules implemented:
 *   - net N.0 accepts:  net N.0 and lower netN.0; netcoreapp 1.x..3.1;
 *                       netstandard 1.0..2.1
 *   - netcoreapp X.Y accepts: same/lower netcoreapp; netstandard 1.0..2.0
 *                       (2.1 only for netcoreapp 3.0+)
 *   - netstandard X.Y accepts: same/lower netstandard
 *   - net4xx (.NET Framework) accepts: same/lower net4xx; netstandard 1.0..2.0
 *
 * Platform-specific (e.g. net8.0-windows) accepts the unqualified TFM of the
 * same version, plus everything the unqualified TFM accepts.
 */

interface ParsedTfm {
  family: 'net' | 'netcoreapp' | 'netstandard' | 'netframework' | 'unknown';
  major: number;
  minor: number;
  /** e.g. "windows", "android" - empty for unqualified. */
  platform: string;
  /** Original string for badges/messages. */
  raw: string;
}

export function parseTfm(input: string): ParsedTfm {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  // Long-form variants seen in catalog dependencyGroups.
  const longForm = matchLongForm(lower, raw);
  if (longForm) return longForm;

  // Short forms: net8.0, net8.0-windows, netcoreapp3.1, netstandard2.1, net48
  const m = /^(net|netcoreapp|netstandard)(\d+)(?:\.(\d+))?(?:-([a-z0-9.]+))?$/.exec(lower);
  if (!m) return { family: 'unknown', major: 0, minor: 0, platform: '', raw };

  const prefix = m[1] as 'net' | 'netcoreapp' | 'netstandard';
  const a = Number(m[2]);
  const b = m[3] !== undefined ? Number(m[3]) : 0;
  const platform = m[4] ?? '';

  if (prefix === 'net') {
    // "net5.0" and above use major.minor; "net48" / "net472" / "net40" are .NET Framework.
    if (m[3] !== undefined) {
      return { family: 'net', major: a, minor: b, platform, raw };
    }
    // Compact .NET Framework moniker like "net48" => 4.8
    if (a >= 10 && a < 100) {
      return { family: 'netframework', major: Math.floor(a / 10), minor: a % 10, platform, raw };
    }
    if (a >= 100 && a < 1000) {
      return {
        family: 'netframework',
        major: Math.floor(a / 100),
        minor: Math.floor((a % 100) / 10),
        platform,
        raw,
      };
    }
    return { family: 'unknown', major: 0, minor: 0, platform: '', raw };
  }

  return { family: prefix, major: a, minor: b, platform, raw };
}

function matchLongForm(lower: string, raw: string): ParsedTfm | undefined {
  // ".NETStandard2.0", ".NETFramework4.6.2", ".NETCoreApp,Version=v3.1"
  // We're lenient about format; catalog data has shown several variants.
  let m = /^\.netstandard,?\s*(?:version=v?)?(\d+)(?:\.(\d+))?/.exec(lower);
  if (m) {
    return {
      family: 'netstandard',
      major: Number(m[1]),
      minor: m[2] !== undefined ? Number(m[2]) : 0,
      platform: '',
      raw,
    };
  }
  m = /^\.netframework,?\s*(?:version=v?)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(lower);
  if (m) {
    return {
      family: 'netframework',
      major: Number(m[1]),
      minor: m[2] !== undefined ? Number(m[2]) : 0,
      platform: '',
      raw,
    };
  }
  m = /^\.netcoreapp,?\s*(?:version=v?)?(\d+)(?:\.(\d+))?/.exec(lower);
  if (m) {
    return {
      family: 'netcoreapp',
      major: Number(m[1]),
      minor: m[2] !== undefined ? Number(m[2]) : 0,
      platform: '',
      raw,
    };
  }
  return undefined;
}

function le(a: { major: number; minor: number }, b: { major: number; minor: number }): boolean {
  if (a.major !== b.major) return a.major < b.major;
  return a.minor <= b.minor;
}

/**
 * Returns true if a project targeting `projectTfm` can install a package
 * that supports `packageTfm`.
 */
export function isPackageTfmCompatible(projectTfm: string, packageTfm: string): boolean {
  const project = parseTfm(projectTfm);
  const pkg = parseTfm(packageTfm);
  if (project.family === 'unknown' || pkg.family === 'unknown') return false;

  // A package's platform-qualified TFM (e.g. net8.0-windows) requires the
  // project's TFM to match the platform. Strict on this for correctness.
  if (pkg.platform && pkg.platform !== project.platform) return false;

  switch (project.family) {
    case 'net': {
      if (pkg.family === 'net') return le(pkg, project);
      if (pkg.family === 'netcoreapp') {
        // .NET 5+ can consume any netcoreapp.
        return le(pkg, { major: 3, minor: 1 });
      }
      if (pkg.family === 'netstandard') return le(pkg, { major: 2, minor: 1 });
      return false;
    }
    case 'netcoreapp': {
      if (pkg.family === 'netcoreapp') return le(pkg, project);
      if (pkg.family === 'netstandard') {
        // netcoreapp >= 3.0 supports netstandard2.1; older only up to 2.0.
        const ceiling =
          project.major > 3 || (project.major === 3 && project.minor >= 0)
            ? { major: 2, minor: 1 }
            : { major: 2, minor: 0 };
        return le(pkg, ceiling);
      }
      return false;
    }
    case 'netstandard': {
      if (pkg.family === 'netstandard') return le(pkg, project);
      return false;
    }
    case 'netframework': {
      if (pkg.family === 'netframework') return le(pkg, project);
      if (pkg.family === 'netstandard') return le(pkg, { major: 2, minor: 0 });
      return false;
    }
    default:
      return false;
  }
}

/**
 * For a single project, determine if a package version (with its list of
 * supported TFMs) is installable.
 */
export function isVersionCompatibleWithProject(
  projectTfms: readonly string[],
  packageTfms: readonly string[],
): boolean {
  if (packageTfms.length === 0) {
    // No data; assume compatible with a flag the UI can surface.
    return true;
  }
  // For multi-targeted projects, a single compatible match in the package is
  // enough - NuGet picks the closest TFM at restore time.
  return projectTfms.some((proj) => packageTfms.some((pkg) => isPackageTfmCompatible(proj, pkg)));
}
