import type { PackageRow, Project } from '@nuget-compass/shared';

interface ProjectListProps {
  projects: Project[];
  rowsByProject: Record<string, PackageRow[]>;
}

export function ProjectList({ projects, rowsByProject }: ProjectListProps): JSX.Element {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p>No .NET projects found in this workspace.</p>
        <p className="muted">
          Open a folder containing a <code>.csproj</code>, <code>.fsproj</code>, or{' '}
          <code>.vbproj</code> file.
        </p>
      </div>
    );
  }

  return (
    <ul className="project-list">
      {projects.map((p) => (
        <li key={p.path} className="project-group">
          <header className="project-header">
            <span className="project-name">{p.name}</span>
            <span className="project-tfm">({p.targetFrameworks.join('; ')})</span>
          </header>
          <PackageRows rows={rowsByProject[p.path] ?? []} />
        </li>
      ))}
    </ul>
  );
}

function PackageRows({ rows }: { rows: PackageRow[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="muted indent">No packages.</p>;
  }
  return (
    <ul className="package-rows">
      {rows.map((row) => (
        <li key={row.package.id} className="package-row">
          <span className="package-name">{row.package.id}</span>
          <span className="package-version">{row.package.resolvedVersion}</span>
          {row.newestAllowed && row.newestAllowed !== row.package.resolvedVersion ? (
            <span className="package-newer">→ {row.newestAllowed}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
