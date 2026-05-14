import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityCategory,
  ActivityEntry,
  ActivityLevel,
} from '@nuget-compass/shared';
import type { ActivityFilters } from '../state/reducer.js';

const LEVELS: ActivityLevel[] = ['info', 'warn', 'error', 'debug'];

const CATEGORIES: Array<ActivityCategory | 'all'> = [
  'all',
  'scan',
  'update',
  'install',
  'remove',
  'restore',
  'diagnostic',
  'source',
  'general',
];

interface Props {
  entries: ActivityEntry[];
  filters: ActivityFilters;
  onSetLevel: (level: ActivityLevel, enabled: boolean) => void;
  onSetCategory: (category: ActivityCategory | 'all') => void;
  onClear: () => void;
  onRevealOutputChannel: () => void;
}

export function ActivityPanel({
  entries,
  filters,
  onSetLevel,
  onSetCategory,
  onClear,
  onRevealOutputChannel,
}: Props): JSX.Element {
  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          filters.levels[e.level] &&
          (filters.category === 'all' || e.category === filters.category),
      ),
    [entries, filters],
  );

  // Auto-scroll to newest unless the user has scrolled up.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  useEffect(() => {
    if (!stickToBottom) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, stickToBottom]);

  function onScroll(): void {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStickToBottom(atBottom);
  }

  return (
    <div className="activity-panel">
      <div className="activity-toolbar">
        <div className="activity-filters">
          {LEVELS.map((level) => (
            <label key={level} className="activity-level-chip">
              <input
                type="checkbox"
                checked={filters.levels[level]}
                onChange={(e) => onSetLevel(level, e.target.checked)}
              />
              <span className={`activity-level-label activity-level-${level}`}>{level}</span>
            </label>
          ))}
          <select
            className="activity-category-select"
            value={filters.category}
            onChange={(e) => onSetCategory(e.target.value as ActivityCategory | 'all')}
            aria-label="Filter activity by category"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c}
              </option>
            ))}
          </select>
        </div>
        <div className="activity-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onRevealOutputChannel}
            title="Open the Compass: NuGet output channel"
          >
            Output
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div
        className="activity-list"
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
      >
        {visible.length === 0 ? (
          <div className="activity-empty">
            {entries.length === 0
              ? 'No activity yet. Scans, updates, and errors will appear here.'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          visible.map((e) => <ActivityRow key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(entry.detail && entry.detail.trim().length > 0);
  const ctxLabel = formatContext(entry);
  const ts = new Date(entry.timestamp);
  const timeLabel = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
  return (
    <div className={`activity-row activity-row-${entry.level}`}>
      <button
        type="button"
        className="activity-row-head"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
      >
        <span className="activity-time" title={ts.toISOString()}>
          {timeLabel}
        </span>
        <span className={`activity-badge activity-badge-${entry.level}`}>
          {entry.level.toUpperCase()}
        </span>
        <span className="activity-category">{entry.category}</span>
        {ctxLabel ? <span className="activity-context">{ctxLabel}</span> : null}
        <span className="activity-message">{entry.message}</span>
        {hasDetail ? (
          <span className="activity-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        ) : null}
      </button>
      {open && hasDetail ? <pre className="activity-detail">{entry.detail}</pre> : null}
    </div>
  );
}

function formatContext(entry: ActivityEntry): string {
  const ctx = entry.context;
  if (!ctx) return '';
  const bits: string[] = [];
  if (ctx.projectName) bits.push(ctx.projectName);
  if (ctx.packageId) {
    bits.push(ctx.version ? `${ctx.packageId}@${ctx.version}` : ctx.packageId);
  }
  return bits.join(' · ');
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
