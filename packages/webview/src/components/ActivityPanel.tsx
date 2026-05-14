import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityCategory,
  ActivityEntry,
  ActivityLevel,
} from '@nuget-compass/shared';
import type { ActivityFilters } from '../state/reducer.js';

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

/**
 * Severity floor: clicking a level shows that level and everything more severe.
 * Order is least → most severe; the user picks the floor.
 */
const SEVERITY_ORDER: ActivityLevel[] = ['debug', 'info', 'warn', 'error'];

/** Gap between consecutive rows (ms) that triggers a "burst separator". */
const BURST_GAP_MS = 4000;

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
  // Derive the "severity floor" from the levels filter. The lowest-severity
  // level currently enabled is the floor; everything ≥ that severity shows.
  const floor: ActivityLevel = useMemo(() => {
    for (const level of SEVERITY_ORDER) {
      if (filters.levels[level]) return level;
    }
    return 'error';
  }, [filters.levels]);

  function setFloor(next: ActivityLevel): void {
    const nextIdx = SEVERITY_ORDER.indexOf(next);
    for (const level of SEVERITY_ORDER) {
      const enabled = SEVERITY_ORDER.indexOf(level) >= nextIdx;
      if (filters.levels[level] !== enabled) onSetLevel(level, enabled);
    }
  }

  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          filters.levels[e.level] &&
          (filters.category === 'all' || e.category === filters.category),
      ),
    [entries, filters],
  );

  // Auto-scroll preference. The checkbox is the source of truth; the user can
  // also pause auto-scroll by scrolling up (we flip the checkbox off so the
  // state stays coherent).
  const listRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  // Suppress the scroll-handler flip during programmatic scroll-to-bottom.
  const programmaticScroll = useRef(false);

  useEffect(() => {
    if (!autoScroll) return;
    const el = listRef.current;
    if (!el) return;
    programmaticScroll.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      programmaticScroll.current = false;
    });
  }, [visible.length, autoScroll]);

  function onScroll(): void {
    if (programmaticScroll.current) return;
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && autoScroll) setAutoScroll(false);
  }

  function jumpToTail(): void {
    setAutoScroll(true);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  const errorCount = useMemo(
    () => entries.filter((e) => e.level === 'error').length,
    [entries],
  );

  return (
    <div className="activity-panel">
      <div className="activity-toolbar">
        <div className="activity-filters">
          <div
            className="seg activity-severity"
            role="group"
            aria-label="Minimum severity"
            title="Show this level and anything more severe"
          >
            {SEVERITY_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                className={
                  'seg-btn activity-severity-btn activity-severity-' +
                  level +
                  (floor === level ? ' seg-btn-active' : '')
                }
                onClick={() => setFloor(level)}
                aria-pressed={floor === level}
              >
                {level}
              </button>
            ))}
          </div>
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
          {errorCount > 0 ? (
            <span className="activity-error-count" title={`${errorCount} error(s) in buffer`}>
              {errorCount} error{errorCount === 1 ? '' : 's'}
            </span>
          ) : null}
          <label
            className="activity-autoscroll"
            title="Keep the view pinned to the newest entry"
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoScroll(next);
                if (next) {
                  const el = listRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }
              }}
            />
            <span>Auto-scroll</span>
          </label>
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

      <div className="activity-viewport">
        <div
          className="activity-list"
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
        >
          {visible.length === 0 ? (
            <div className="activity-empty">
              <div className="activity-empty-frame">
                {entries.length === 0
                  ? 'No activity yet. Scans, updates, and errors will appear here.'
                  : 'No entries match the current filters.'}
              </div>
            </div>
          ) : (
            visible.map((e, i) => {
              const prev = visible[i - 1];
              const burst = prev && e.timestamp - prev.timestamp > BURST_GAP_MS;
              return (
                <div key={e.id}>
                  {burst ? (
                    <div className="activity-burst-sep" aria-hidden>
                      <span>{formatGap(e.timestamp - prev.timestamp)}</span>
                    </div>
                  ) : null}
                  <ActivityRow entry={e} />
                </div>
              );
            })
          )}
        </div>
        {!autoScroll && visible.length > 0 ? (
          <button
            type="button"
            className="activity-tail-pill"
            onClick={jumpToTail}
            title="Jump to newest"
          >
            ↓ Tail
          </button>
        ) : null}
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

  // Severity badge only for non-info rows — INFO is the implicit default and
  // painting a chip on every one of those entries is wallpaper.
  const showBadge = entry.level !== 'info';

  function onToggle(e: React.MouseEvent | React.KeyboardEvent): void {
    e.stopPropagation();
    if (hasDetail) setOpen((v) => !v);
  }

  return (
    <div
      className={
        `activity-row activity-row-${entry.level}` + (hasDetail ? ' activity-row-expandable' : '')
      }
    >
      <div className="activity-row-head">
        <span className="activity-rail" aria-hidden />
        <span className="activity-time" title={ts.toISOString()}>
          {timeLabel}
        </span>
        {showBadge ? (
          <span className={`activity-badge activity-badge-${entry.level}`}>
            {entry.level.toUpperCase()}
          </span>
        ) : (
          <span className="activity-badge-spacer" aria-hidden />
        )}
        <span className="activity-category">{entry.category}</span>
        <span className="activity-message">
          {ctxLabel ? <span className="activity-context">{ctxLabel}</span> : null}
          {entry.message}
        </span>
        {hasDetail ? (
          <button
            type="button"
            className="activity-chevron"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? 'Collapse details' : 'Expand details'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="activity-chevron-spacer" aria-hidden />
        )}
      </div>
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

function formatGap(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
