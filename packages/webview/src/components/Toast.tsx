import { useEffect } from 'react';
import type { Toast as ToastModel } from '../state/reducer.js';

interface ToastProps {
  toast: ToastModel | undefined;
  onDismiss: () => void;
  onShowOutput?: () => void;
}

export function Toast({ toast, onDismiss, onShowOutput }: ToastProps): React.JSX.Element | null {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <span aria-hidden="true">{toast.kind === 'success' ? '✓' : 'ℹ'}</span>
      <span>{toast.message}</span>
      {onShowOutput ? (
        <button type="button" className="toast-link" onClick={onShowOutput}>
          Show output
        </button>
      ) : null}
    </div>
  );
}
