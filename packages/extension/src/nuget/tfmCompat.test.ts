import { describe, expect, it } from 'vitest';
import { isPackageTfmCompatible, isVersionCompatibleWithProject, parseTfm } from './tfmCompat.js';

describe('parseTfm', () => {
  it('parses short modern net forms', () => {
    expect(parseTfm('net8.0')).toMatchObject({ family: 'net', major: 8, minor: 0, platform: '' });
    expect(parseTfm('net10.0')).toMatchObject({ family: 'net', major: 10, minor: 0, platform: '' });
  });

  it('parses platform-qualified', () => {
    expect(parseTfm('net8.0-windows')).toMatchObject({ family: 'net', major: 8, minor: 0, platform: 'windows' });
  });

  it('parses .NET Framework compact', () => {
    expect(parseTfm('net48')).toMatchObject({ family: 'netframework', major: 4, minor: 8 });
    expect(parseTfm('net472')).toMatchObject({ family: 'netframework', major: 4, minor: 7 });
  });

  it('parses netcoreapp', () => {
    expect(parseTfm('netcoreapp3.1')).toMatchObject({ family: 'netcoreapp', major: 3, minor: 1 });
  });

  it('parses netstandard', () => {
    expect(parseTfm('netstandard2.0')).toMatchObject({ family: 'netstandard', major: 2, minor: 0 });
    expect(parseTfm('netstandard2.1')).toMatchObject({ family: 'netstandard', major: 2, minor: 1 });
  });

  it('parses long-form catalog strings', () => {
    expect(parseTfm('.NETStandard2.0')).toMatchObject({ family: 'netstandard', major: 2, minor: 0 });
    expect(parseTfm('.NETFramework4.6.2')).toMatchObject({ family: 'netframework', major: 4, minor: 6 });
    expect(parseTfm('.NETCoreApp,Version=v3.1')).toMatchObject({ family: 'netcoreapp', major: 3, minor: 1 });
  });

  it('returns unknown for garbage', () => {
    expect(parseTfm('not-a-tfm').family).toBe('unknown');
  });
});

describe('isPackageTfmCompatible', () => {
  it('net8 accepts net8 and lower netN.0', () => {
    expect(isPackageTfmCompatible('net8.0', 'net8.0')).toBe(true);
    expect(isPackageTfmCompatible('net8.0', 'net6.0')).toBe(true);
    expect(isPackageTfmCompatible('net8.0', 'net5.0')).toBe(true);
  });

  it('net8 rejects net10', () => {
    expect(isPackageTfmCompatible('net8.0', 'net10.0')).toBe(false);
    expect(isPackageTfmCompatible('net8.0', 'net9.0')).toBe(false);
  });

  it('net8 accepts netstandard2.0 and 2.1', () => {
    expect(isPackageTfmCompatible('net8.0', 'netstandard2.0')).toBe(true);
    expect(isPackageTfmCompatible('net8.0', 'netstandard2.1')).toBe(true);
  });

  it('net8 accepts older netcoreapp', () => {
    expect(isPackageTfmCompatible('net8.0', 'netcoreapp3.1')).toBe(true);
    expect(isPackageTfmCompatible('net8.0', 'netcoreapp2.1')).toBe(true);
  });

  it('netstandard2.0 rejects newer netstandard', () => {
    expect(isPackageTfmCompatible('netstandard2.0', 'netstandard2.1')).toBe(false);
    expect(isPackageTfmCompatible('netstandard2.0', 'netstandard2.0')).toBe(true);
  });

  it('netcoreapp3.0 accepts netstandard2.1', () => {
    expect(isPackageTfmCompatible('netcoreapp3.0', 'netstandard2.1')).toBe(true);
  });

  it('netcoreapp2.1 rejects netstandard2.1', () => {
    expect(isPackageTfmCompatible('netcoreapp2.1', 'netstandard2.1')).toBe(false);
    expect(isPackageTfmCompatible('netcoreapp2.1', 'netstandard2.0')).toBe(true);
  });

  it('net48 accepts netstandard up to 2.0 only', () => {
    expect(isPackageTfmCompatible('net48', 'netstandard2.0')).toBe(true);
    expect(isPackageTfmCompatible('net48', 'netstandard2.1')).toBe(false);
  });

  it('net48 rejects modern netN', () => {
    expect(isPackageTfmCompatible('net48', 'net8.0')).toBe(false);
  });

  it('platform mismatch fails', () => {
    expect(isPackageTfmCompatible('net8.0', 'net8.0-windows')).toBe(false);
    expect(isPackageTfmCompatible('net8.0-windows', 'net8.0-windows')).toBe(true);
  });
});

describe('isVersionCompatibleWithProject', () => {
  it('returns true if any package TFM matches any project TFM', () => {
    expect(isVersionCompatibleWithProject(['net8.0'], ['net6.0', 'netstandard2.0'])).toBe(true);
  });

  it('returns false if none match', () => {
    expect(isVersionCompatibleWithProject(['net8.0'], ['net10.0', 'net9.0'])).toBe(false);
  });

  it('returns true when no package TFM data is provided (unknown -> assume compatible)', () => {
    expect(isVersionCompatibleWithProject(['net8.0'], [])).toBe(true);
  });

  it('handles multi-target projects (any project TFM matching a package TFM is enough)', () => {
    expect(isVersionCompatibleWithProject(['net6.0', 'net8.0'], ['net8.0'])).toBe(true);
    expect(isVersionCompatibleWithProject(['net6.0', 'net8.0'], ['net10.0'])).toBe(false);
  });

  it('handles real catalog data (long form)', () => {
    // Microsoft.Extensions.Configuration 10.0.7 actually multi-targets these.
    const supported = ['.NETFramework4.6.2', 'net8.0', 'net9.0', 'net10.0', '.NETStandard2.0'];
    expect(isVersionCompatibleWithProject(['net8.0'], supported)).toBe(true);
  });

  it('handles EF Core 10.0.7 case (net10.0 only)', () => {
    expect(isVersionCompatibleWithProject(['net8.0'], ['net10.0'])).toBe(false);
    expect(isVersionCompatibleWithProject(['net10.0'], ['net10.0'])).toBe(true);
  });
});
