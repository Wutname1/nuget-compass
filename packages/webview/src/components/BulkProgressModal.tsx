import type { BulkProgressState } from '@nuget-compass/shared';

interface Props {
  state: BulkProgressState;
  onCancel: () => void;
  onMinimize: () => void;
}

/**
 * Modal-style overlay anchored inside the webview. We deliberately don't use
 * VS Code's notification toasts for this — NuGet's own restore notifications
 * stack at the bottom right and cover them. This panel lives inside our own
 * surface, so it can't be hidden by another extension's noise.
 */
export function BulkProgressModal({ state, onCancel, onMinimize }: Props): JSX.Element {
  const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
  const title =
    state.kind === 'update-all' ? 'Updating packages' : 'Bulk update';
  return (
    <div className="bulk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bulk-modal-title">
      <div className="bulk-modal">
        <div className="bulk-modal-head">
          <div>
            <h2 className="bulk-modal-title" id="bulk-modal-title">
              {title}
              {state.projectName ? <span className="bulk-modal-project"> · {state.projectName}</span> : null}
            </h2>
            <p className="bulk-modal-subtitle">
              {state.current} of {state.total}
              {state.currentItem ? ` · ${state.currentItem}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="bulk-modal-min"
            onClick={onMinimize}
            title="Minimize — work continues in the background"
            aria-label="Minimize progress"
          >
            ▁
          </button>
        </div>

        <div className="bulk-modal-progress" aria-hidden>
          <div className="bulk-modal-bar" style={{ width: `${pct}%` }} />
        </div>

        <div className="bulk-modal-stats">
          <span className="bulk-stat bulk-stat-ok">
            <span className="bulk-stat-dot" /> {state.succeeded} updated
          </span>
          {state.failed > 0 ? (
            <span className="bulk-stat bulk-stat-fail">
              <span className="bulk-stat-dot" /> {state.failed} failed
            </span>
          ) : null}
          {state.total > 0 ? (
            <span className="bulk-stat bulk-stat-pending">
              {Math.max(0, state.total - state.current)} remaining
            </span>
          ) : null}
        </div>

        <div className="bulk-modal-actions">
          {state.cancelRequested ? (
            <span className="bulk-modal-cancelling">Stopping after the current package…</span>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            onClick={onMinimize}
          >
            Minimize
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onCancel}
            disabled={!state.cancellable || Boolean(state.cancelRequested)}
            title="Stop the run after the current package finishes"
          >
            {state.cancelRequested ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PillProps {
  state: BulkProgressState;
  onRestore: () => void;
  onCancel: () => void;
}

/**
 * Slim header pill shown when the modal is minimized. Click it to bring the
 * modal back; the X cancels the run.
 */
export function BulkProgressPill({ state, onRestore, onCancel }: PillProps): JSX.Element {
  const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
  return (
    <button
      type="button"
      className="bulk-pill"
      onClick={onRestore}
      title="Show progress details"
    >
      <span className="bulk-pill-spinner" aria-hidden />
      <span className="bulk-pill-label">
        {state.current}/{state.total}
        {state.projectName ? ` · ${state.projectName}` : ''}
      </span>
      <span className="bulk-pill-pct">{pct}%</span>
      <span
        role="button"
        tabIndex={0}
        aria-label="Cancel"
        title="Cancel"
        className={
          'bulk-pill-cancel' +
          (state.cancelRequested ? ' bulk-pill-cancel-disabled' : '')
        }
        onClick={(e) => {
          e.stopPropagation();
          if (!state.cancelRequested) onCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            if (!state.cancelRequested) onCancel();
          }
        }}
      >
        ×
      </span>
    </button>
  );
}
