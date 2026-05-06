/**
 * A NuGet version is SemVer 2.0.0 with one extension: it can have a fourth
 * numeric segment (legacy), e.g. "1.2.3.4". We parse what we need for
 * comparison and update-level filtering, and ignore build metadata after `+`.
 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Legacy 4th segment ("revision"); 0 when absent. */
  revision: number;
  /** Pre-release identifiers, e.g. ["alpha", "1"] for "1.0.0-alpha.1". */
  prerelease: string[];
  /** The original version string, normalized. */
  raw: string;
}

const VERSION_RE =
  /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): ParsedVersion | undefined {
  const m = VERSION_RE.exec(input.trim());
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3] ?? 0),
    revision: Number(m[4] ?? 0),
    prerelease: m[5] ? m[5].split('.') : [],
    raw: input.trim(),
  };
}

export function isPrerelease(v: ParsedVersion): boolean {
  return v.prerelease.length > 0;
}

/**
 * Compare two parsed versions. Returns negative/zero/positive in the usual
 * Array.sort sense. Pre-release versions sort below their stable counterpart
 * per SemVer.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.revision !== b.revision) return a.revision - b.revision;

  const aPre = a.prerelease.length > 0;
  const bPre = b.prerelease.length > 0;
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;

  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (aNum !== bNum) {
      // Numeric identifiers always have lower precedence than alphanumeric.
      return aNum ? -1 : 1;
    } else {
      const cmp = ai.localeCompare(bi);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}
