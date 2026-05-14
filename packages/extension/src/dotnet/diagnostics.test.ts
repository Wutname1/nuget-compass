import { describe, expect, it } from 'vitest';
import {
  dedupeDiagnostics,
  parseDiagnosticsFromOutput,
  parseDiagnosticsFromProblems,
} from './diagnostics.js';

describe('parseDiagnosticsFromOutput', () => {
  it('parses NU1605 downgrade errors with package + versions', () => {
    const output = [
      `C:\\Code\\CRTI-Web\\CRTI.Data\\CRTI.Data.csproj : error NU1605: Warning As Error: Detected package downgrade: Microsoft.EntityFrameworkCore.SqlServer from 10.0.8 to 10.0.7. Reference the package directly from the project to select a different version.  [C:\\Code\\CRTI-Web\\CRTI.sln]`,
      `C:\\Code\\CRTI-Web\\CRTI.Data\\CRTI.Data.csproj : error NU1605:  CRTI.Data -> Microsoft.EntityFrameworkCore.SqlServer.NetTopologySuite 10.0.8 -> Microsoft.EntityFrameworkCore.SqlServer (>= 10.0.8)  [C:\\Code\\CRTI-Web\\CRTI.sln]`,
      `C:\\Code\\CRTI-Web\\CRTI.Data\\CRTI.Data.csproj : error NU1605:  CRTI.Data -> Microsoft.EntityFrameworkCore.SqlServer (>= 10.0.7) [C:\\Code\\CRTI-Web\\CRTI.sln]`,
    ].join('\n');
    const diags = parseDiagnosticsFromOutput('fallback.csproj', output);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const downgrade = diags.find((d) => d.code === 'NU1605' && d.packageId);
    expect(downgrade?.packageId).toBe('Microsoft.EntityFrameworkCore.SqlServer');
    expect(downgrade?.fromVersion).toBe('10.0.8');
    expect(downgrade?.toVersion).toBe('10.0.7');
    expect(downgrade?.level).toBe('error');
    expect(downgrade?.fix?.kind).toBe('pin-package');
    if (downgrade?.fix?.kind === 'pin-package') {
      expect(downgrade.fix.version).toBe('10.0.8');
    }
    expect(downgrade?.projectPath).toBe('C:\\Code\\CRTI-Web\\CRTI.Data\\CRTI.Data.csproj');
  });

  it('parses NU1701 framework-mismatch warnings', () => {
    const output =
      `C:\\Code\\Foo.csproj : warning NU1701: Package 'MsGraphConsumer 1.0.30' was restored using '.NETFramework,Version=v4.6.1, .NETFramework,Version=v4.8.1' instead of the project target framework 'net10.0'. This package may not be fully compatible with your project. [C:\\Code\\Foo.sln]`;
    const diags = parseDiagnosticsFromOutput('fallback.csproj', output);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('NU1701');
    expect(diags[0]?.packageId).toBe('MsGraphConsumer');
    expect(diags[0]?.fromVersion).toBe('1.0.30');
    expect(diags[0]?.targetFramework).toBe('net10.0');
    expect(diags[0]?.level).toBe('warning');
  });

  it('parses NU1902 vulnerability warnings with severity and URL', () => {
    const output =
      `C:\\Code\\Foo.csproj : warning NU1902: Package 'HtmlSanitizer' 8.0.838 has a known moderate severity vulnerability, https://github.com/advisories/GHSA-j92c-7v7g-gj3f [C:\\Code\\Foo.sln]`;
    const diags = parseDiagnosticsFromOutput('fallback.csproj', output);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('NU1902');
    expect(diags[0]?.packageId).toBe('HtmlSanitizer');
    expect(diags[0]?.fromVersion).toBe('8.0.838');
    expect(diags[0]?.severity).toBe('moderate');
    expect(diags[0]?.url).toContain('GHSA-j92c-7v7g-gj3f');
    expect(diags[0]?.fix?.kind).toBe('update-package');
  });

  it('parses NU1510 prunable PackageReference warnings', () => {
    const output =
      `C:\\Code\\Foo.csproj : warning NU1510: PackageReference System.Net.Http will not be pruned. Consider removing this package from your dependencies, as it is likely unnecessary. [C:\\Code\\Foo.sln]`;
    const diags = parseDiagnosticsFromOutput('fallback.csproj', output);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('NU1510');
    expect(diags[0]?.packageId).toBe('System.Net.Http');
    expect(diags[0]?.fix?.kind).toBe('remove-package');
  });

  it('returns empty for benign output', () => {
    expect(parseDiagnosticsFromOutput('p', '')).toEqual([]);
    expect(parseDiagnosticsFromOutput('p', 'Restore complete.')).toEqual([]);
  });
});

describe('parseDiagnosticsFromProblems', () => {
  it('promotes .NET 10 problems[] entries into structured diagnostics', () => {
    const diags = parseDiagnosticsFromProblems('fallback.csproj', [
      {
        level: 'error',
        project: 'C:/x/Foo.csproj',
        text:
          'NU1605: Detected package downgrade: Foo.Bar from 2.0.0 to 1.5.0. Reference the package directly from the project to select a different version.',
      },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('NU1605');
    expect(diags[0]?.packageId).toBe('Foo.Bar');
    expect(diags[0]?.fromVersion).toBe('2.0.0');
    expect(diags[0]?.toVersion).toBe('1.5.0');
  });
});

describe('dedupeDiagnostics', () => {
  it('collapses repeated NU1605 entries from the same downgrade across the dep graph', () => {
    const sample = parseDiagnosticsFromOutput(
      'p.csproj',
      [
        `p.csproj : error NU1605: Warning As Error: Detected package downgrade: Foo from 2.0.0 to 1.0.0. Reference the package directly from the project to select a different version.`,
        `q.csproj : error NU1605: Warning As Error: Detected package downgrade: Foo from 2.0.0 to 1.0.0. Reference the package directly from the project to select a different version.`,
        // Same downgrade reported a third time from yet another root project.
        `r.csproj : error NU1605: Warning As Error: Detected package downgrade: Foo from 2.0.0 to 1.0.0. Reference the package directly from the project to select a different version.`,
      ].join('\n'),
    );
    // Each line has its own projectPath because the prefix overrides the
    // fallback. Dedupe keys on (code, packageId, fromVersion, toVersion,
    // projectPath) so three projects collapse to three records — but a
    // re-report on the SAME project collapses to one.
    expect(sample).toHaveLength(3);
    const deduped = dedupeDiagnostics([...sample, ...sample]);
    expect(deduped).toHaveLength(3);
  });

  it('sorts errors before warnings', () => {
    const items = [
      ...parseDiagnosticsFromOutput(
        'p.csproj',
        `p.csproj : warning NU1701: Package 'X 1.0.0' was restored using '.NETFramework,Version=v4.6.1' instead of the project target framework 'net10.0'.`,
      ),
      ...parseDiagnosticsFromOutput(
        'p.csproj',
        `p.csproj : error NU1605: Warning As Error: Detected package downgrade: Foo from 2.0.0 to 1.0.0.`,
      ),
    ];
    const deduped = dedupeDiagnostics(items);
    expect(deduped[0]?.level).toBe('error');
  });
});
