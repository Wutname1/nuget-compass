import { useMemo, useState } from 'react';
import type { Diagnostic, DiagnosticFix } from '@nuget-compass/shared';

interface Props {
  diagnostics: Diagnostic[];
  suppressedCodes: string[];
  fixesInFlight: Record<string, true>;
  fixResults: Record<
    string,
    {
      success: boolean;
      message: string;
      manualIntervention?: { reason: string; projects: string[]; packageIds: string[] };
    }
  >;
  onApplyFix: (key: string, fix: DiagnosticFix) => void;
  onSuppressCode: (code: string, suppressed: boolean) => void;
  onDismissFixResult: (key: string) => void;
}

interface CodeMeta {
  title: string;
  /** Short description of the underlying problem. */
  blurb: string;
  /** What the suggested fix does. Shown alongside the apply button. */
  fixHint?: string;
}

const CODE_META: Record<string, CodeMeta> = {
  NU1605: {
    title: 'Package downgrade',
    blurb:
      'A transitive dependency wants a newer version than the one being installed. NuGet refuses the downgrade.',
    fixHint:
      'Pin the higher version as a top-level <PackageReference> in the project. If pinning A surfaces a new NU1605 against B, NuGet Compass walks the chain automatically.',
  },
  NU1701: {
    title: 'Target framework mismatch',
    blurb:
      'The restored package was built for .NET Framework but the project targets a newer TFM. The package may not work at runtime.',
    fixHint: 'Find a replacement or a .NET-compatible version of the package.',
  },
  NU1902: {
    title: 'Known vulnerability (moderate)',
    blurb: 'A package version has a security advisory. Update to a patched version.',
    fixHint: 'Open the package and pick a version without the advisory.',
  },
  NU1903: {
    title: 'Known vulnerability (high)',
    blurb: 'A package version has a high-severity security advisory.',
    fixHint: 'Open the package and pick a version without the advisory.',
  },
  NU1904: {
    title: 'Known vulnerability (critical)',
    blurb: 'A package version has a critical-severity security advisory.',
    fixHint: 'Open the package and pick a version without the advisory.',
  },
  NU1510: {
    title: 'Reference not pruned',
    blurb:
      'A <PackageReference> is already provided by the .NET SDK for this target framework. The explicit reference is unnecessary.',
    fixHint: 'Remove the explicit <PackageReference>.',
  },
};

export function DiagnosticsPanel(props: Props): JSX.Element | null {
  const { diagnostics, suppressedCodes, fixesInFlight, fixResults } = props;
  const [collapsed, setCollapsed] = useState(false);

  const visible = useMemo(
    () => diagnostics.filter((d) => !suppressedCodes.includes(d.code)),
    [diagnostics, suppressedCodes],
  );
  const grouped = useMemo(() => groupByCode(visible), [visible]);
  const errorCount = visible.filter((d) => d.level === 'error').length;
  const warnCount = visible.filter((d) => d.level === 'warning').length;

  if (visible.length === 0) return null;

  return (
    <section className="diagnostics-panel" aria-label="NuGet diagnostics">
      <header className="diagnostics-header">
        <button
          type="button"
          className="diagnostics-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="diagnostics-caret">{collapsed ? '▸' : '▾'}</span>
          <strong>
            NuGet issues
            {errorCount > 0 ? <span className="pill pill-error">{errorCount}</span> : null}
            {warnCount > 0 ? <span className="pill pill-warn">{warnCount}</span> : null}
          </strong>
        </button>
        {suppressedCodes.length > 0 ? (
          <span className="diagnostics-suppressed-note" title={suppressedCodes.join(', ')}>
            {suppressedCodes.length} type{suppressedCodes.length === 1 ? '' : 's'} hidden
          </span>
        ) : null}
      </header>

      {collapsed ? null : (
        <div className="diagnostics-body">
          {grouped.map((group) => (
            <DiagnosticGroup
              key={group.code}
              code={group.code}
              items={group.items}
              fixesInFlight={fixesInFlight}
              fixResults={fixResults}
              onApplyFix={props.onApplyFix}
              onSuppressCode={props.onSuppressCode}
              onDismissFixResult={props.onDismissFixResult}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface GroupProps {
  code: string;
  items: Diagnostic[];
  fixesInFlight: Record<string, true>;
  fixResults: Props['fixResults'];
  onApplyFix: Props['onApplyFix'];
  onSuppressCode: Props['onSuppressCode'];
  onDismissFixResult: Props['onDismissFixResult'];
}

function DiagnosticGroup(props: GroupProps): JSX.Element {
  const { code, items } = props;
  const meta = CODE_META[code];
  const headline = meta?.title ?? code;
  const blurb = meta?.blurb;
  const fixHint = meta?.fixHint;
  const level = items.some((d) => d.level === 'error') ? 'error' : 'warning';

  return (
    <div className={`diagnostic-group diagnostic-group-${level}`}>
      <div className="diagnostic-group-header">
        <span className={`diagnostic-badge diagnostic-badge-${level}`}>{code}</span>
        <strong>{headline}</strong>
        <span className="diagnostic-count">
          {items.length} {items.length === 1 ? 'occurrence' : 'occurrences'}
        </span>
        <button
          type="button"
          className="btn-link"
          title={`Hide all ${code} diagnostics in this workspace.`}
          onClick={() => props.onSuppressCode(code, true)}
        >
          Don't show this type again
        </button>
      </div>
      {blurb ? <p className="diagnostic-blurb">{blurb}</p> : null}
      {fixHint ? <p className="diagnostic-fix-hint">{fixHint}</p> : null}
      <ul className="diagnostic-items">
        {items.map((d) => (
          <DiagnosticItem
            key={d.key}
            diagnostic={d}
            inFlight={Boolean(props.fixesInFlight[d.key])}
            result={props.fixResults[d.key]}
            onApplyFix={props.onApplyFix}
            onDismissFixResult={props.onDismissFixResult}
          />
        ))}
      </ul>
    </div>
  );
}

interface ItemProps {
  diagnostic: Diagnostic;
  inFlight: boolean;
  result?: Props['fixResults'][string];
  onApplyFix: Props['onApplyFix'];
  onDismissFixResult: Props['onDismissFixResult'];
}

function DiagnosticItem({
  diagnostic,
  inFlight,
  result,
  onApplyFix,
  onDismissFixResult,
}: ItemProps): JSX.Element {
  const projectName = basename(diagnostic.projectPath);
  const label = formatLabel(diagnostic);
  return (
    <li className="diagnostic-item">
      <div className="diagnostic-item-row">
        <span className="diagnostic-item-target">{label}</span>
        {projectName ? <span className="diagnostic-item-project">in {projectName}</span> : null}
        {diagnostic.fix ? (
          <button
            type="button"
            className="btn-secondary diagnostic-fix-button"
            disabled={inFlight}
            title={diagnostic.fix.kind === 'pin-package'
              ? `Pin ${diagnostic.fix.packageId} to ${diagnostic.fix.version}`
              : diagnostic.fix.kind === 'remove-package'
                ? `Remove ${diagnostic.fix.packageId}`
                : diagnostic.fix.kind === 'update-package'
                  ? `Open ${diagnostic.fix.packageId}`
                  : `Show ${diagnostic.fix.packageId}`}
            onClick={() => onApplyFix(diagnostic.key, diagnostic.fix!)}
          >
            {inFlight ? 'Working…' : fixButtonLabel(diagnostic.fix)}
          </button>
        ) : null}
        {diagnostic.url ? (
          <a
            className="diagnostic-link"
            href={diagnostic.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            Advisory ↗
          </a>
        ) : null}
      </div>
      {result ? (
        <div
          className={
            'diagnostic-result ' +
            (result.success ? 'diagnostic-result-ok' : 'diagnostic-result-bad')
          }
          role="status"
        >
          <span>{result.message}</span>
          {result.manualIntervention ? (
            <details className="diagnostic-manual">
              <summary>Manual fix steps</summary>
              <p>{result.manualIntervention.reason}</p>
              <p>
                Edit these projects and pin the conflicting packages by hand, then run{' '}
                <code>dotnet restore</code>:
              </p>
              <ul>
                {result.manualIntervention.projects.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p>Packages involved: {result.manualIntervention.packageIds.join(', ')}</p>
            </details>
          ) : null}
          <button
            type="button"
            className="btn-link"
            onClick={() => onDismissFixResult(diagnostic.key)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </li>
  );
}

function fixButtonLabel(fix: DiagnosticFix): string {
  switch (fix.kind) {
    case 'pin-package':
      return `Pin to ${fix.version}`;
    case 'remove-package':
      return 'Remove reference';
    case 'update-package':
      return 'Choose version';
    case 'reveal-package':
      return 'Show in list';
  }
}

function formatLabel(d: Diagnostic): string {
  if (d.packageId && d.fromVersion && d.toVersion) {
    return `${d.packageId} ${d.toVersion} → ${d.fromVersion}`;
  }
  if (d.packageId && d.fromVersion) {
    return `${d.packageId} ${d.fromVersion}`;
  }
  if (d.packageId) {
    return d.packageId;
  }
  // Trim the multi-line message to its first line for the headline.
  const firstLine = d.message.split(/\r?\n/, 1)[0] ?? d.message;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
}

function basename(p: string): string {
  if (!p) return '';
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] ?? p;
}

function groupByCode(items: Diagnostic[]): Array<{ code: string; items: Diagnostic[] }> {
  const map = new Map<string, Diagnostic[]>();
  for (const d of items) {
    const list = map.get(d.code) ?? [];
    list.push(d);
    map.set(d.code, list);
  }
  // Errors first, then alphabetical by code.
  return Array.from(map.entries())
    .map(([code, list]) => ({ code, items: list }))
    .sort((a, b) => {
      const aErr = a.items.some((d) => d.level === 'error') ? 0 : 1;
      const bErr = b.items.some((d) => d.level === 'error') ? 0 : 1;
      if (aErr !== bErr) return aErr - bErr;
      return a.code.localeCompare(b.code);
    });
}
