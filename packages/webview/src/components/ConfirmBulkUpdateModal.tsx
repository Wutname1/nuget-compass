export interface BulkUpdateItem {
  packageId: string;
  toVersion: string;
  fromVersions: string[];
  projectPaths: string[];
  hasTransitive: boolean;
}

interface ConfirmBulkUpdateModalProps {
  items: BulkUpdateItem[] | undefined;
  projectNames: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmBulkUpdateModal({
  items,
  projectNames,
  onCancel,
  onConfirm,
}: ConfirmBulkUpdateModalProps): React.JSX.Element | null {
  if (!items || items.length === 0) return null;
  const projectCount = items.reduce((acc, it) => acc + it.projectPaths.length, 0);
  const anyTransitive = items.some((it) => it.hasTransitive);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-bulk-update-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-title" id="confirm-bulk-update-title">
          Update {items.length} {items.length === 1 ? 'package' : 'packages'}?
        </p>
        <div className="modal-body">
          This will update {items.length} {items.length === 1 ? 'package' : 'packages'} across{' '}
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, maxHeight: 240, overflowY: 'auto' }}>
            {items.map((it) => (
              <li key={it.packageId} style={{ padding: '2px 0' }}>
                <strong>{it.packageId}</strong> → <code>{it.toVersion}</code>
                <span style={{ opacity: 0.7 }}>
                  {' '}
                  ({it.projectPaths.length}{' '}
                  {it.projectPaths.length === 1 ? 'project' : 'projects'})
                </span>
                {it.projectPaths.length <= 4 ? (
                  <span style={{ opacity: 0.6, fontSize: '0.85em' }}>
                    {' '}
                    — {it.projectPaths.map((p) => projectNames[p] ?? p).join(', ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {anyTransitive ? (
            <p style={{ marginTop: 8, opacity: 0.85 }}>
              Some packages are currently transitive and will be pinned as top-level
              &lt;PackageReference&gt; entries.
            </p>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            Update all
          </button>
        </div>
      </div>
    </div>
  );
}
