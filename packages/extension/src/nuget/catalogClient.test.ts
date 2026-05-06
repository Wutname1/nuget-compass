import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NuGetCatalogClient } from './catalogClient.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

interface MockFetchEntry {
  url: string;
  body: unknown;
}

function makeFetch(entries: MockFetchEntry[]) {
  const calls: string[] = [];
  const map = new Map(entries.map((e) => [e.url, e.body]));
  const fn = vi.fn(async (url: string | URL): Promise<Response> => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push(u);
    const body = map.get(u);
    if (body === undefined) {
      return new Response(`not mocked: ${u}`, { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { fn, calls };
}

describe('NuGetCatalogClient.getPackageVersions (inlined-pages package)', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'nuget-compass-test-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns all versions with TFM data when all pages are inline', async () => {
    const indexBody = JSON.parse(readFileSync(join(fixturesDir, 'mec', 'index.json'), 'utf8'));
    const { fn, calls } = makeFetch([
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.extensions.configuration/index.json',
        body: indexBody,
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const client = new NuGetCatalogClient({ cacheDir });
    const versions = await client.getPackageVersions('Microsoft.Extensions.Configuration');

    expect(versions.length).toBeGreaterThan(70);

    // Multi-target version - all five TFMs should be present.
    const v10 = versions.find((v) => v.version === '10.0.7');
    expect(v10).toBeDefined();
    expect(v10!.supportedFrameworks).toEqual(
      expect.arrayContaining(['net8.0', 'net9.0', 'net10.0', '.NETStandard2.0']),
    );

    // Only the index was fetched - pages were inline.
    expect(calls).toHaveLength(1);
  });

  it('hits the in-memory cache on the second call', async () => {
    const indexBody = JSON.parse(readFileSync(join(fixturesDir, 'mec', 'index.json'), 'utf8'));
    const { fn, calls } = makeFetch([
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.extensions.configuration/index.json',
        body: indexBody,
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const client = new NuGetCatalogClient({ cacheDir });
    await client.getPackageVersions('Microsoft.Extensions.Configuration');
    await client.getPackageVersions('Microsoft.Extensions.Configuration');

    expect(calls).toHaveLength(1);
  });
});

describe('NuGetCatalogClient.getPackageVersions (paginated package)', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'nuget-compass-test-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('fetches detached pages and returns combined version list', async () => {
    const indexBody = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'index.json'), 'utf8'),
    );
    const page9 = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'page-9.0.12-10.0.7.json'), 'utf8'),
    );
    const page6 = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'page-6.0.30-9.0.11.json'), 'utf8'),
    );

    // The captured EF Core index has 4 pages. We have fixtures for the top 2;
    // mock the other 2 with empty stubs to confirm we fetch all four.
    const { fn, calls } = makeFetch([
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/index.json',
        body: indexBody,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/9.0.12/10.0.7.json',
        body: page9,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/6.0.30/9.0.11.json',
        body: page6,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/3.1.16/6.0.29.json',
        body: { '@id': '...', count: 0, items: [] },
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/0.0.1-alpha/3.1.15.json',
        body: { '@id': '...', count: 0, items: [] },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const client = new NuGetCatalogClient({ cacheDir });
    const versions = await client.getPackageVersions('Microsoft.EntityFrameworkCore');

    // EF Core 10.0.7 is single-target net10.0.
    const v10 = versions.find((v) => v.version === '10.0.7');
    expect(v10).toBeDefined();
    expect(v10!.supportedFrameworks).toEqual(['net10.0']);

    // EF Core 8.0.0 should target net8.0.
    const v8 = versions.find((v) => v.version === '8.0.0');
    expect(v8).toBeDefined();
    expect(v8!.supportedFrameworks).toEqual(['net8.0']);

    // Index + 4 pages.
    expect(calls).toHaveLength(5);
  });

  it('serves pages from disk on a subsequent fresh client', async () => {
    const indexBody = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'index.json'), 'utf8'),
    );
    const page9 = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'page-9.0.12-10.0.7.json'), 'utf8'),
    );
    const page6 = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'page-6.0.30-9.0.11.json'), 'utf8'),
    );
    const otherPages = [
      'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/3.1.16/6.0.29.json',
      'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/0.0.1-alpha/3.1.15.json',
    ].map((url) => ({ url, body: { '@id': '...', count: 0, items: [] } }));

    const entries = [
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/index.json',
        body: indexBody,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/9.0.12/10.0.7.json',
        body: page9,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/6.0.30/9.0.11.json',
        body: page6,
      },
      ...otherPages,
    ];

    // First client warms the disk cache.
    const first = makeFetch(entries);
    vi.stubGlobal('fetch', first.fn);
    const c1 = new NuGetCatalogClient({ cacheDir });
    await c1.getPackageVersions('Microsoft.EntityFrameworkCore');
    expect(first.calls.length).toBe(5);

    // Second client (fresh in-memory cache, same cacheDir): only the index
    // should be re-fetched; page contents come from disk.
    const second = makeFetch(entries);
    vi.stubGlobal('fetch', second.fn);
    const c2 = new NuGetCatalogClient({ cacheDir });
    await c2.getPackageVersions('Microsoft.EntityFrameworkCore');

    expect(second.calls).toEqual([
      'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/index.json',
    ]);
  });

  it('writes one cache file per page', async () => {
    const indexBody = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'index.json'), 'utf8'),
    );
    const page9 = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'page-9.0.12-10.0.7.json'), 'utf8'),
    );
    const page6 = JSON.parse(
      readFileSync(join(fixturesDir, 'efcore', 'page-6.0.30-9.0.11.json'), 'utf8'),
    );

    const { fn } = makeFetch([
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/index.json',
        body: indexBody,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/9.0.12/10.0.7.json',
        body: page9,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/6.0.30/9.0.11.json',
        body: page6,
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/3.1.16/6.0.29.json',
        body: { '@id': '...', count: 0, items: [] },
      },
      {
        url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.entityframeworkcore/page/0.0.1-alpha/3.1.15.json',
        body: { '@id': '...', count: 0, items: [] },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const client = new NuGetCatalogClient({ cacheDir });
    await client.getPackageVersions('Microsoft.EntityFrameworkCore');

    const pkgDir = join(cacheDir, 'm', 'microsoft.entityframeworkcore');
    expect(existsSync(pkgDir)).toBe(true);
    // Confirm the highest page exists with our expected naming.
    const expected = join(pkgDir, 'microsoft.entityframeworkcore__9.0.12__10.0.7.json');
    expect(existsSync(expected)).toBe(true);
  });
});

describe('NuGetCatalogClient.invalidate', () => {
  it('removes cached pages and forces a refetch', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'nuget-compass-test-'));
    try {
      const indexBody = JSON.parse(
        readFileSync(join(fixturesDir, 'mec', 'index.json'), 'utf8'),
      );
      const { fn, calls } = makeFetch([
        {
          url: 'https://api.nuget.org/v3/registration5-semver1/microsoft.extensions.configuration/index.json',
          body: indexBody,
        },
      ]);
      vi.stubGlobal('fetch', fn);

      const client = new NuGetCatalogClient({ cacheDir });
      await client.getPackageVersions('Microsoft.Extensions.Configuration');
      const callsBefore = calls.length;

      await client.invalidate('Microsoft.Extensions.Configuration');
      await client.getPackageVersions('Microsoft.Extensions.Configuration');

      // Memory was cleared so the index gets re-requested.
      expect(calls.length).toBeGreaterThan(callsBefore);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});
