import { describe, expect, it } from 'vitest';
import { newestAllowed, passesUpdateLevel } from './filter.js';
import { parseVersion } from './parse.js';

const v = (s: string) => parseVersion(s)!;

describe('passesUpdateLevel', () => {
  it('patch: same major.minor and strictly newer patch', () => {
    expect(
      passesUpdateLevel(v('1.2.4'), { current: v('1.2.3'), level: 'patch', includePrerelease: false }),
    ).toBe(true);
    expect(
      passesUpdateLevel(v('1.3.0'), { current: v('1.2.3'), level: 'patch', includePrerelease: false }),
    ).toBe(false);
    expect(
      passesUpdateLevel(v('1.2.3'), { current: v('1.2.3'), level: 'patch', includePrerelease: false }),
    ).toBe(false);
  });

  it('minor: same major, strictly newer overall', () => {
    expect(
      passesUpdateLevel(v('1.5.0'), { current: v('1.2.3'), level: 'minor', includePrerelease: false }),
    ).toBe(true);
    expect(
      passesUpdateLevel(v('2.0.0'), { current: v('1.2.3'), level: 'minor', includePrerelease: false }),
    ).toBe(false);
  });

  it('major: any strictly newer version', () => {
    expect(
      passesUpdateLevel(v('2.0.0'), { current: v('1.2.3'), level: 'major', includePrerelease: false }),
    ).toBe(true);
    expect(
      passesUpdateLevel(v('1.0.0'), { current: v('1.2.3'), level: 'major', includePrerelease: false }),
    ).toBe(false);
  });

  it('excludes prerelease unless includePrerelease', () => {
    expect(
      passesUpdateLevel(v('1.5.0-rc'), {
        current: v('1.2.3'),
        level: 'minor',
        includePrerelease: false,
      }),
    ).toBe(false);
    expect(
      passesUpdateLevel(v('1.5.0-rc'), {
        current: v('1.2.3'),
        level: 'minor',
        includePrerelease: true,
      }),
    ).toBe(true);
  });
});

describe('newestAllowed', () => {
  const candidates = [
    '1.0.0', '1.2.3', '1.2.4', '1.5.0', '1.5.1-rc.1', '1.6.0', '2.0.0', '2.1.0',
  ];

  it('returns highest patch within current major.minor', () => {
    expect(newestAllowed('1.2.3', candidates, 'patch', false)).toBe('1.2.4');
  });

  it('returns highest minor within current major', () => {
    expect(newestAllowed('1.2.3', candidates, 'minor', false)).toBe('1.6.0');
  });

  it('returns absolute highest with major', () => {
    expect(newestAllowed('1.2.3', candidates, 'major', false)).toBe('2.1.0');
  });

  it('skips prerelease without flag', () => {
    expect(newestAllowed('1.5.0', candidates, 'minor', false)).toBe('1.6.0');
  });

  it('considers prerelease with flag', () => {
    // 1.5.1-rc.1 sorts above 1.5.0 but below 1.6.0; highest within minor is still 1.6.0
    expect(newestAllowed('1.5.0', candidates, 'minor', true)).toBe('1.6.0');
  });

  it('returns undefined when nothing qualifies', () => {
    expect(newestAllowed('2.1.0', candidates, 'patch', false)).toBeUndefined();
  });

  it('returns undefined for unparseable current', () => {
    expect(newestAllowed('garbage', candidates, 'minor', false)).toBeUndefined();
  });
});
