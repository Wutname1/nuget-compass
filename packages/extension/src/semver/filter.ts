import type { UpdateLevel } from '@nuget-compass/shared';
import { type ParsedVersion, parseVersion, isPrerelease, compareVersions } from './parse.js';

export interface UpdateLevelFilterOptions {
  current: ParsedVersion;
  level: UpdateLevel;
  includePrerelease: boolean;
}

/**
 * Returns true if a candidate version is "newer than current" within the
 * allowed update level.
 *
 * - patch: same major.minor, patch must be strictly greater
 * - minor: same major, candidate must be strictly newer overall
 * - major: candidate must be strictly newer overall
 *
 * Prerelease versions are excluded unless includePrerelease is true.
 */
export function passesUpdateLevel(
  candidate: ParsedVersion,
  options: UpdateLevelFilterOptions,
): boolean {
  if (isPrerelease(candidate) && !options.includePrerelease) return false;
  if (compareVersions(candidate, options.current) <= 0) return false;

  switch (options.level) {
    case 'patch':
      return (
        candidate.major === options.current.major && candidate.minor === options.current.minor
      );
    case 'minor':
      return candidate.major === options.current.major;
    case 'major':
      return true;
  }
}

/**
 * Convenience: parse the strings, drop unparseable entries, sort newest-first,
 * and return the highest version that passes the update-level rule. Returns
 * undefined if nothing qualifies.
 */
export function newestAllowed(
  currentRaw: string,
  candidates: readonly string[],
  level: UpdateLevel,
  includePrerelease: boolean,
): string | undefined {
  const current = parseVersion(currentRaw);
  if (!current) return undefined;

  let best: ParsedVersion | undefined;
  for (const c of candidates) {
    const parsed = parseVersion(c);
    if (!parsed) continue;
    if (!passesUpdateLevel(parsed, { current, level, includePrerelease })) continue;
    if (!best || compareVersions(parsed, best) > 0) {
      best = parsed;
    }
  }
  return best?.raw;
}
