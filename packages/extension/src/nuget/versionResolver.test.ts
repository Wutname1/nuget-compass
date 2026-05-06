import { describe, expect, it } from 'vitest';
import type { FilterState } from '@nuget-compass/shared';
import {
  resolveAvailableVersions,
  resolveNewestAllowed,
} from './versionResolver.js';
import type { NuGetCatalogClient, PackageVersionMetadata } from './catalogClient.js';

function makeCatalog(versions: PackageVersionMetadata[]): NuGetCatalogClient {
  return {
    async getPackageVersions(): Promise<PackageVersionMetadata[]> {
      return versions;
    },
    async getVersionMetadata(): Promise<PackageVersionMetadata> {
      throw new Error('not used by these tests');
    },
    async invalidate(): Promise<void> {},
    // Fields not used by the resolver, kept off the public surface.
  } as unknown as NuGetCatalogClient;
}

const filtersDefault: FilterState = {
  tfm: 'compatible',
  updateLevel: 'minor',
  includePrerelease: false,
  showTransitive: false,
};

const efCoreVersions: PackageVersionMetadata[] = [
  { id: 'EFC', version: '10.0.7', listed: true, supportedFrameworks: ['net10.0'] },
  { id: 'EFC', version: '10.0.0', listed: true, supportedFrameworks: ['net10.0'] },
  { id: 'EFC', version: '9.0.15', listed: true, supportedFrameworks: ['net9.0'] },
  { id: 'EFC', version: '9.0.0', listed: true, supportedFrameworks: ['net9.0'] },
  { id: 'EFC', version: '8.0.29', listed: true, supportedFrameworks: ['net8.0'] },
  { id: 'EFC', version: '8.0.0', listed: true, supportedFrameworks: ['net8.0'] },
  { id: 'EFC', version: '8.0.0-rc.1', listed: true, supportedFrameworks: ['net8.0'] },
];

const mecVersions: PackageVersionMetadata[] = [
  {
    id: 'MEC',
    version: '10.0.7',
    listed: true,
    supportedFrameworks: ['net8.0', 'net9.0', 'net10.0', 'netstandard2.0'],
  },
  { id: 'MEC', version: '8.0.1', listed: true, supportedFrameworks: ['net8.0', 'netstandard2.0'] },
  { id: 'MEC', version: '8.0.0', listed: true, supportedFrameworks: ['net8.0', 'netstandard2.0'] },
];

describe('resolveNewestAllowed', () => {
  it('EF Core on net8 with major-allowed picks 8.0.29 because 9.x and 10.x are net-only-newer', async () => {
    const newest = await resolveNewestAllowed({
      packageId: 'EFC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major' },
      catalog: makeCatalog(efCoreVersions),
    });
    expect(newest).toBe('8.0.29');
  });

  it('EF Core on net8 with minor stays in 8.x', async () => {
    const newest = await resolveNewestAllowed({
      packageId: 'EFC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'minor' },
      catalog: makeCatalog(efCoreVersions),
    });
    expect(newest).toBe('8.0.29');
  });

  it('EF Core on net10 with major-allowed picks 10.0.7', async () => {
    const newest = await resolveNewestAllowed({
      packageId: 'EFC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net10.0'],
      filters: { ...filtersDefault, updateLevel: 'major' },
      catalog: makeCatalog(efCoreVersions),
    });
    expect(newest).toBe('10.0.7');
  });

  it('M.E.Configuration on net8 with major picks 10.0.7 (multi-target compatible)', async () => {
    const newest = await resolveNewestAllowed({
      packageId: 'MEC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major' },
      catalog: makeCatalog(mecVersions),
    });
    expect(newest).toBe('10.0.7');
  });

  it('respects "show all" mode (TFM filter off): returns 10.0.7 for EF Core on net8 even though incompatible', async () => {
    const newest = await resolveNewestAllowed({
      packageId: 'EFC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major', tfm: 'all' },
      catalog: makeCatalog(efCoreVersions),
    });
    expect(newest).toBe('10.0.7');
  });

  it('skips prerelease unless includePrerelease', async () => {
    const v = [
      { id: 'P', version: '2.0.0-rc.1', listed: true, supportedFrameworks: ['net8.0'] },
      { id: 'P', version: '1.0.0', listed: true, supportedFrameworks: ['net8.0'] },
    ];
    const stable = await resolveNewestAllowed({
      packageId: 'P',
      currentVersion: '1.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major' },
      catalog: makeCatalog(v),
    });
    expect(stable).toBeUndefined();

    const withPre = await resolveNewestAllowed({
      packageId: 'P',
      currentVersion: '1.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major', includePrerelease: true },
      catalog: makeCatalog(v),
    });
    expect(withPre).toBe('2.0.0-rc.1');
  });

  it('returns undefined when no version qualifies', async () => {
    const newest = await resolveNewestAllowed({
      packageId: 'EFC',
      currentVersion: '10.0.7',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'patch' },
      catalog: makeCatalog(efCoreVersions),
    });
    expect(newest).toBeUndefined();
  });
});

describe('resolveAvailableVersions', () => {
  it('returns versions sorted newest-first with compatibility flag', async () => {
    const result = await resolveAvailableVersions({
      packageId: 'EFC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major' },
      catalog: makeCatalog(efCoreVersions),
    });

    expect(result.versions[0]?.version).toBe('10.0.7');
    expect(result.versions[0]?.isCompatible).toBe(false);

    const v8 = result.versions.find((v) => v.version === '8.0.29');
    expect(v8?.isCompatible).toBe(true);
  });

  it('returns newestAllowed reflecting filters', async () => {
    const result = await resolveAvailableVersions({
      packageId: 'EFC',
      currentVersion: '8.0.0',
      projectTargetFrameworks: ['net8.0'],
      filters: { ...filtersDefault, updateLevel: 'major' },
      catalog: makeCatalog(efCoreVersions),
    });
    expect(result.newestAllowed).toBe('8.0.29');
  });

  it('marks version with no TFM data as compatible (assume-compatible fallback)', async () => {
    const result = await resolveAvailableVersions({
      packageId: 'X',
      currentVersion: '0.9.0',
      projectTargetFrameworks: ['net8.0'],
      filters: filtersDefault,
      catalog: makeCatalog([
        { id: 'X', version: '1.0.0', listed: true, supportedFrameworks: [] },
      ]),
    });
    expect(result.versions[0]?.isCompatible).toBe(true);
  });
});
