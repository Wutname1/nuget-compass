import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDeprecatedJson } from './deprecated.js';
import { packageKey } from './vulnerable.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

describe('parseDeprecatedJson', () => {
  it('parses the captured fixture (xunit -> xunit.v3)', () => {
    const raw = readFileSync(join(fixturesDir, 'net8-deprecated.json'), 'utf8');
    const map = parseDeprecatedJson(raw);
    const projectPath = 'C:/code/nuget-compass/fixtures/net8-mixed-versions/TestApp.csproj';
    const xunit = map.get(packageKey(projectPath, 'xunit'));
    expect(xunit?.reasons).toEqual(['Legacy']);
    expect(xunit?.alternatePackage).toEqual({ id: 'xunit.v3', versionRange: '>= 0.0.0' });
  });

  it('returns empty for empty input', () => {
    expect(parseDeprecatedJson('').size).toBe(0);
  });

  it('preserves message when present', () => {
    const synthetic = JSON.stringify({
      version: 1,
      projects: [
        {
          path: '/x/A.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              topLevelPackages: [
                {
                  id: 'OldPkg',
                  resolvedVersion: '1.0',
                  deprecationReasons: ['Other'],
                  message: 'Use NewPkg instead',
                },
              ],
            },
          ],
        },
      ],
    });
    const map = parseDeprecatedJson(synthetic);
    const info = Array.from(map.values())[0];
    expect(info?.message).toBe('Use NewPkg instead');
    expect(info?.alternatePackage).toBeUndefined();
  });

  it('skips entries without deprecationReasons', () => {
    const synthetic = JSON.stringify({
      version: 1,
      projects: [
        {
          path: '/x/A.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              topLevelPackages: [{ id: 'Fine', resolvedVersion: '1.0' }],
            },
          ],
        },
      ],
    });
    expect(parseDeprecatedJson(synthetic).size).toBe(0);
  });
});
