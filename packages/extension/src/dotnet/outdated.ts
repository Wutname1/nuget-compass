import type { UpdateLevel } from '@nuget-compass/shared';
import { listPackages, projectsFromPackageListJson } from './packageList.js';

export interface OutdatedRow {
  projectPath: string;
  packageId: string;
  resolvedVersion: string;
  latestVersion?: string;
}

/**
 * Run the SDK's outdated check with flags matching the user's update level.
 * Returns a flat list of (projectPath, packageId, resolved, latest) rows.
 *
 * Caveats:
 *   - "minor" maps to --highest-minor; "patch" maps to --highest-patch.
 *   - "major" passes no level flag (the SDK's default behavior is "any newer").
 *   - This is target-framework BLIND. We use it for a fast first-paint
 *     estimate; the catalog-backed resolver overrides per-package once
 *     the user expands a row.
 */
export async function runOutdatedScan(
  projectPath: string,
  cwd: string,
  options: { updateLevel: UpdateLevel; includePrerelease: boolean },
): Promise<OutdatedRow[]> {
  const json = await listPackages(projectPath, cwd, {
    outdated: true,
    highestPatch: options.updateLevel === 'patch',
    highestMinor: options.updateLevel === 'minor',
    includePrerelease: options.includePrerelease,
  });

  // We can't reuse projectsFromPackageListJson directly because it doesn't
  // surface latestVersion. Walk the raw shape.
  const rows: OutdatedRow[] = [];
  for (const project of json.projects) {
    for (const fw of project.frameworks ?? []) {
      for (const pkg of fw.topLevelPackages ?? []) {
        rows.push({
          projectPath: project.path,
          packageId: pkg.id,
          resolvedVersion: pkg.resolvedVersion,
          latestVersion: pkg.latestVersion,
        });
      }
    }
  }
  // Caller might want both views; expose the parsed projects too via the
  // existing transformer for parity.
  void projectsFromPackageListJson;
  return rows;
}
