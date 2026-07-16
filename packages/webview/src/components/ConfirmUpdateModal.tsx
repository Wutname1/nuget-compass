import type { UpdateRequest } from './DetailPanel.js';

interface ConfirmUpdateModalProps {
  request: UpdateRequest | undefined;
  projectNames: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirm dialog shown before fanning out a multi-project update. Lists each
 * project explicitly so the user knows the blast radius.
 */
export function ConfirmUpdateModal({
  request,
  projectNames,
  onCancel,
  onConfirm,
}: ConfirmUpdateModalProps): React.JSX.Element | null {
  if (!request) return null;
  const count = request.projectPaths.length;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-update-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-title" id="confirm-update-title">
          Update {count} {count === 1 ? 'project' : 'projects'}?
        </p>
        <div className="modal-body">
          Update <strong>{request.packageId}</strong> to <code>{request.toVersion}</code> in:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {request.projectPaths.map((p) => (
              <li key={p} style={{ padding: '2px 0' }}>
                {projectNames[p] ?? p}
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
