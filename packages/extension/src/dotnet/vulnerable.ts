import type { VulnerabilityInfo } from '@nuget-compass/shared';
import { runDotnet } from './exec.js';

/**
 * Map of `${projectPath}::${packageId}` -> VulnerabilityInfo[].
 * Empty map means no vulnerabilities; not the same as a scan failure.
 */
export type VulnerabilitiesByPackage = Map<string, VulnerabilityInfo[]>;

const VALID_SEVERITIES: ReadonlySet<VulnerabilityInfo['severity']> = new Set([
  'Low',
  'Moderate',
  'High',
  'Critical',
]);

export async function scanVulnerabilities(
  projectPath: string,
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<VulnerabilitiesByPackage> {
  const result = await runDotnet(
    ['package', 'list', '--project', projectPath, '--vulnerable', '--format', 'json'],
    cwd,
    options.timeoutMs,
  );
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `dotnet package list --vulnerable exited ${result.code} with no output. stderr:\n${result.stderr}`,
    );
  }
  return parseVulnerableJson(result.stdout);
}

export function parseVulnerableJson(raw: string): VulnerabilitiesByPackage {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Could not parse --vulnerable output: ${(err as Error).message}`);
  }

  const out: VulnerabilitiesByPackage = new Map();
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
        const vulns = (pkg as { vulnerabilities?: unknown }).vulnerabilities;
        if (typeof id !== 'string' || !Array.isArray(vulns) || vulns.length === 0) continue;

        const list: VulnerabilityInfo[] = [];
        for (const v of vulns) {
          if (typeof v !== 'object' || v === null) continue;
          const severity = (v as { severity?: unknown }).severity;
          const url = (v as { advisoryurl?: unknown }).advisoryurl;
          if (typeof severity !== 'string' || typeof url !== 'string') continue;
          if (!VALID_SEVERITIES.has(severity as VulnerabilityInfo['severity'])) continue;
          list.push({
            severity: severity as VulnerabilityInfo['severity'],
            advisoryUrl: url,
          });
        }
        if (list.length > 0) {
          out.set(packageKey(path, id), list);
        }
      }
    }
  }
  return out;
}

export function packageKey(projectPath: string, packageId: string): string {
  return `${projectPath}::${packageId}`;
}
