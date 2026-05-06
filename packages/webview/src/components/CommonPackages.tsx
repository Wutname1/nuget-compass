import type { PackageRow } from '@nuget-compass/shared';

interface CommonPackagesProps {
  rowsByProject: Record<string, PackageRow[]>;
  projectNames: Record<string, string>;
}

interface CommonEntry {
  packageId: string;
  versionsByProject: Map<string, string>;
  hasDrift: boolean;
}

export function CommonPackages({
  rowsByProject,
  projectNames,
}: CommonPackagesProps): JSX.Element | null {
  const entries = collectCommon(rowsByProject);
  if (entries.length === 0) return null;

  return (
    <details className="common-packages">
      <summary>
        Common packages <span className="muted">({entries.length})</span>
      </summary>
      <ul className="common-list">
        {entries.map((entry) => (
          <li key={entry.packageId} className="common-row">
            <span className="common-id">{entry.packageId}</span>
            {entry.hasDrift ? (
              <span className="badge badge-drift" title="Versions differ between projects">
                version drift
              </span>
            ) : null}
            <ul className="common-versions">
              {Array.from(entry.versionsByProject.entries()).map(([projectPath, version]) => (
                <li key={projectPath}>
                  <span className="muted">{projectNames[projectPath] ?? projectPath}:</span>{' '}
                  <span className="version-string">{version}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

function collectCommon(rowsByProject: Record<string, PackageRow[]>): CommonEntry[] {
  const byPkg = new Map<string, Map<string, string>>();
  for (const [projectPath, rows] of Object.entries(rowsByProject)) {
    for (const row of rows) {
      let projects = byPkg.get(row.package.id);
      if (!projects) {
        projects = new Map();
        byPkg.set(row.package.id, projects);
      }
      projects.set(projectPath, row.package.resolvedVersion);
    }
  }
  const entries: CommonEntry[] = [];
  for (const [packageId, versionsByProject] of byPkg) {
    if (versionsByProject.size < 2) continue;
    const versions = new Set(versionsByProject.values());
    entries.push({
      packageId,
      versionsByProject,
      hasDrift: versions.size > 1,
    });
  }
  return entries.sort((a, b) => {
    if (a.hasDrift !== b.hasDrift) return a.hasDrift ? -1 : 1;
    return a.packageId.localeCompare(b.packageId);
  });
}
