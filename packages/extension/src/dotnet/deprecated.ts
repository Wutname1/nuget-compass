import type { DeprecationInfo } from '@nuget-compass/shared';
import { runDotnet } from './exec.js';
import { packageKey } from './vulnerable.js';

/**
 * Map of `${projectPath}::${packageId}` -> DeprecationInfo.
 */
export type DeprecationsByPackage = Map<string, DeprecationInfo>;

export async function scanDeprecations(
  projectPath: string,
  cwd: string,
  options: { timeoutMs?: number; extraEnv?: Record<string, string> } = {},
): Promise<DeprecationsByPackage> {
  const result = await runDotnet(
    ['package', 'list', '--project', projectPath, '--deprecated', '--format', 'json'],
    cwd,
    options.timeoutMs,
    options.extraEnv,
  );
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package list --deprecated exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }
  return parseDeprecatedJson(result.stdout);
}

export function parseDeprecatedJson(raw: string): DeprecationsByPackage {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Could not parse --deprecated output: ${(err as Error).message}`, {
      cause: err,
    });
  }

  const out: DeprecationsByPackage = new Map();
  const projects = (parsed as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return out;

  for (const project of projects) {
    if (typeof project !== 'object' || project === null) continue;
    const path = (project as { path?: unknown }).path;
    if (typeof path !== 'string') continue;
    const frameworks = (project as { frameworks?: unknown }).frameworks;
    if (!Array.isArray(frameworks)) continue;

    for (const fw of frameworks) {
      const top = (fw as { topLevelPackages?: unknown }).topLevelPackages;
      if (!Array.isArray(top)) continue;
      for (const pkg of top) {
        if (typeof pkg !== 'object' || pkg === null) continue;
        const id = (pkg as { id?: unknown }).id;
        const reasons = (pkg as { deprecationReasons?: unknown }).deprecationReasons;
        if (typeof id !== 'string') continue;
        if (!Array.isArray(reasons) || reasons.length === 0) continue;

        const message = (pkg as { message?: unknown }).message;
        const alt = (pkg as { alternativePackage?: unknown }).alternativePackage;

        const info: DeprecationInfo = {
          reasons: reasons.filter((r): r is string => typeof r === 'string'),
        };
        if (typeof message === 'string') info.message = message;
        if (typeof alt === 'object' && alt !== null) {
          const altId = (alt as { id?: unknown }).id;
          const altRange = (alt as { versionRange?: unknown }).versionRange;
          if (typeof altId === 'string' && typeof altRange === 'string') {
            info.alternatePackage = { id: altId, versionRange: altRange };
          }
        }
        out.set(packageKey(path, id), info);
      }
    }
  }
  return out;
}
