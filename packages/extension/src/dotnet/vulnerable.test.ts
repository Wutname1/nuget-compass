import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packageKey, parseVulnerableJson } from './vulnerable.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

describe('parseVulnerableJson', () => {
  it('parses the captured fixture (AutoMapper + System.Text.Json)', () => {
    const raw = readFileSync(join(fixturesDir, 'net8-vulnerable.json'), 'utf8');
    const map = parseVulnerableJson(raw);
    const projectPath = 'C:/code/nuget-compass/fixtures/net8-mixed-versions/TestApp.csproj';

    const auto = map.get(packageKey(projectPath, 'AutoMapper'));
    expect(auto).toHaveLength(1);
    expect(auto?.[0]).toEqual({
      severity: 'High',
      advisoryUrl: 'https://github.com/advisories/GHSA-rvv3-g6hj-g44x',
    });

    const stj = map.get(packageKey(projectPath, 'System.Text.Json'));
    expect(stj).toHaveLength(2);
    expect(stj?.every((v) => v.severity === 'High')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(parseVulnerableJson('').size).toBe(0);
  });

  it('throws on garbage', () => {
    expect(() => parseVulnerableJson('{ not json')).toThrow();
  });

  it('skips packages with no vulnerabilities key', () => {
    const synthetic = JSON.stringify({
      version: 1,
      projects: [
        {
          path: '/x/Foo.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              topLevelPackages: [
                { id: 'NoVuln', requestedVersion: '1.0', resolvedVersion: '1.0' },
              ],
            },
          ],
        },
      ],
    });
    expect(parseVulnerableJson(synthetic).size).toBe(0);
  });

  it('rejects unknown severity values', () => {
    const synthetic = JSON.stringify({
      version: 1,
      projects: [
        {
          path: '/x/Foo.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              topLevelPackages: [
                {
                  id: 'BadSev',
                  resolvedVersion: '1.0',
                  vulnerabilities: [
                    { severity: 'Apocalyptic', advisoryurl: 'http://example.invalid' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const map = parseVulnerableJson(synthetic);
    // Severity didn't validate, so the entry was skipped and the map stays empty.
    expect(map.size).toBe(0);
  });
});
