import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSearchVersions } from './packageSearch.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

describe('parseSearchVersions', () => {
  it('returns dedup ordered list from real EF Core fixture', () => {
    const raw = readFileSync(join(fixturesDir, 'search-efcore.json'), 'utf8');
    const versions = parseSearchVersions(raw);
    expect(versions.length).toBeGreaterThan(150);
    // Spot check known versions exist.
    expect(versions).toContain('8.0.0');
    expect(versions).toContain('10.0.7');
    // No duplicates.
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('handles empty', () => {
    expect(parseSearchVersions('')).toEqual([]);
  });

  it('throws on garbage', () => {
    expect(() => parseSearchVersions('{ not json')).toThrow();
  });

  it('throws on schema mismatch', () => {
    expect(() => parseSearchVersions('{"version": 2}')).toThrow(/schema/);
  });

  it('merges across sources without duplicating', () => {
    const synthetic = JSON.stringify({
      version: 2,
      problems: [],
      searchResult: [
        { sourceName: 'a', packages: [{ id: 'X', version: '1.0' }] },
        { sourceName: 'b', packages: [{ id: 'X', version: '1.0' }, { id: 'X', version: '2.0' }] },
      ],
    });
    expect(parseSearchVersions(synthetic)).toEqual(['1.0', '2.0']);
  });
});
