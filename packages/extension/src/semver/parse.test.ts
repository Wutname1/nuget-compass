import { describe, expect, it } from 'vitest';
import { compareVersions, isPrerelease, parseVersion } from './parse.js';

describe('parseVersion', () => {
  it('parses standard SemVer', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      revision: 0,
      prerelease: [],
      raw: '1.2.3',
    });
  });

  it('parses 4-segment NuGet versions', () => {
    expect(parseVersion('1.2.3.4')?.revision).toBe(4);
  });

  it('parses prerelease tags', () => {
    const v = parseVersion('1.0.0-alpha.2');
    expect(v?.prerelease).toEqual(['alpha', '2']);
    expect(isPrerelease(v!)).toBe(true);
  });

  it('parses 2-segment versions (defaults patch to 0)', () => {
    expect(parseVersion('1.2')).toEqual({
      major: 1,
      minor: 2,
      patch: 0,
      revision: 0,
      prerelease: [],
      raw: '1.2',
    });
  });

  it('strips build metadata', () => {
    const v = parseVersion('1.2.3+abc');
    expect(v?.major).toBe(1);
    expect(v?.minor).toBe(2);
    expect(v?.patch).toBe(3);
  });

  it('returns undefined for garbage', () => {
    expect(parseVersion('not a version')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
  });
});

describe('compareVersions', () => {
  const v = (s: string) => parseVersion(s)!;

  it('compares major/minor/patch', () => {
    expect(compareVersions(v('1.0.0'), v('2.0.0'))).toBeLessThan(0);
    expect(compareVersions(v('1.2.0'), v('1.1.0'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.0.5'), v('1.0.4'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.2.3'), v('1.2.3'))).toBe(0);
  });

  it('treats prerelease as lower than stable of same x.y.z', () => {
    expect(compareVersions(v('1.0.0-rc.1'), v('1.0.0'))).toBeLessThan(0);
    expect(compareVersions(v('1.0.0'), v('1.0.0-rc.1'))).toBeGreaterThan(0);
  });

  it('compares prerelease identifiers', () => {
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-beta'))).toBeLessThan(0);
    expect(compareVersions(v('1.0.0-alpha.1'), v('1.0.0-alpha.2'))).toBeLessThan(0);
    // Numeric < alphanumeric per SemVer
    expect(compareVersions(v('1.0.0-1'), v('1.0.0-alpha'))).toBeLessThan(0);
  });

  it('considers 4-segment revision', () => {
    expect(compareVersions(v('1.2.3.4'), v('1.2.3.5'))).toBeLessThan(0);
    expect(compareVersions(v('1.2.3'), v('1.2.3.1'))).toBeLessThan(0);
  });
});
