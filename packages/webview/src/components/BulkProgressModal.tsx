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

export interface BulkResultState {
  succeeded: number;
  failed: number;
  total: number;
  cancelled: boolean;
  aborted: boolean;
  projectName?: string;
}

interface ResultProps {
  result: BulkResultState;
  onClose: () => void;
  onOpenActivity: () => void;
}

/**
 * Stays on screen after the run completes. We never close it automatically —
 * the user must read why the run stopped and dismiss it explicitly. That
 * matters most when the auto-abort kicks in: a vanished modal with no
 * explanation leaves the user wondering whether anything happened at all.
 */
export function BulkResultModal({
  result,
  onClose,
  onOpenActivity,
}: ResultProps): JSX.Element {
  const skipped = Math.max(0, result.total - result.succeeded - result.failed);
  const headline = result.cancelled
    ? 'Run cancelled'
    : result.aborted
      ? 'Stopped after repeated failures'
      : result.failed > 0
        ? 'Run finished with errors'
        : 'All updates completed';

  const subtitle = result.cancelled
    ? `You cancelled the run after ${result.succeeded} successful update${result.succeeded === 1 ? '' : 's'}. ${skipped} package${skipped === 1 ? '' : 's'} ${skipped === 1 ? 'was' : 'were'} not attempted.`
    : result.aborted
      ? `Three updates failed in a row — the project file is in a state where every later add will hit the same downgrade conflict. ${skipped} package${skipped === 1 ? '' : 's'} ${skipped === 1 ? 'was' : 'were'} skipped. Fix the downgrade first, then run Update All again.`
      : result.failed > 0
        ? `${result.failed} update${result.failed === 1 ? '' : 's'} failed. Look at the Activity log for the dotnet output and any NU-code diagnostics.`
        : `${result.succeeded} package${result.succeeded === 1 ? '' : 's'} updated cleanly.`;

  const tone = result.cancelled
    ? 'cancelled'
    : result.aborted || result.failed > 0
      ? 'error'
      : 'ok';

  return (
    <div className="bulk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bulk-result-title">
      <div className="bulk-modal">
        <div className="bulk-modal-head">
          <div>
            <h2 className="bulk-modal-title" id="bulk-result-title">
              {headline}
              {result.projectName ? (
                <span className="bulk-modal-project"> · {result.projectName}</span>
              ) : null}
            </h2>
            <p className={`bulk-modal-summary bulk-modal-summary-${tone}`}>{subtitle}</p>
          </div>
        </div>

        <div className="bulk-modal-stats">
          <span className="bulk-stat bulk-stat-ok">
            <span className="bulk-stat-dot" /> {result.succeeded} updated
          </span>
          {result.failed > 0 ? (
            <span className="bulk-stat bulk-stat-fail">
              <span className="bulk-stat-dot" /> {result.failed} failed
            </span>
          ) : null}
          {skipped > 0 ? (
            <span className="bulk-stat bulk-stat-pending">{skipped} skipped</span>
          ) : null}
        </div>

        <div className="bulk-modal-actions">
          {result.failed > 0 || result.aborted ? (
            <button type="button" className="btn-secondary" onClick={onOpenActivity}>
              Open Activity log
            </button>
          ) : null}
          <button type="button" className="btn-primary" onClick={onClose} autoFocus>
            Close
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
