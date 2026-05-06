import { runDotnet } from './exec.js';

export interface NuGetSource {
  name: string;
  url: string;
  enabled: boolean;
}

/**
 * Run `dotnet nuget list source` and parse the human-readable output.
 * The CLI does not offer JSON; we parse the "Registered Sources:" section.
 */
export async function listSources(cwd: string): Promise<NuGetSource[]> {
  const result = await runDotnet(['nuget', 'list', 'source', '--format', 'detailed'], cwd);
  if (result.code !== 0) return [];
  return parseDetailedOutput(result.stdout);
}

export function parseDetailedOutput(raw: string): NuGetSource[] {
  const sources: NuGetSource[] = [];
  const lines = raw.split(/\r?\n/);
  // Pattern:
  //   1.  <Name> [Enabled|Disabled]
  //       <url-or-path>
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\d+\.\s+(.+?)\s+\[(Enabled|Disabled)\]\s*$/.exec(lines[i] ?? '');
    if (!m) continue;
    const next = (lines[i + 1] ?? '').trim();
    if (next.length === 0) continue;
    sources.push({ name: m[1]!, url: next, enabled: m[2] === 'Enabled' });
  }
  return sources;
}
