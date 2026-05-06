import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parsePackageListJson,
  projectsFromPackageListJson,
  type DotnetPackageListJson,
} from './packageList.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parsePackageListJson', () => {
  it('parses the captured net8 fixture', () => {
    const data = parsePackageListJson(loadFixture('net8-installed.json'));
    expect(data.version).toBe(1);
    expect(data.projects).toHaveLength(1);
    const proj = data.projects[0]!;
    expect(proj.frameworks).toBeDefined();
    expect(proj.frameworks?.[0]?.framework).toBe('net8.0');
    expect(proj.frameworks?.[0]?.topLevelPackages).toHaveLength(13);
  });

  it('parses the transitive fixture', () => {
    const data = parsePackageListJson(loadFixture('net8-installed-with-transitive.json'));
    const fw = data.projects[0]?.frameworks?.[0];
    expect(fw?.topLevelPackages).toBeDefined();
    expect(fw?.transitivePackages).toBeDefined();
    expect((fw?.transitivePackages ?? []).length).toBeGreaterThan(0);
  });

  it('throws on empty input', () => {
    expect(() => parsePackageListJson('')).toThrow(/empty/i);
  });

  it('throws on malformed JSON', () => {
    expect(() => parsePackageListJson('{ not json')).toThrow(/JSON/i);
  });

  it('throws on schema mismatch', () => {
    expect(() => parsePackageListJson('{"foo": 1}')).toThrow(/schema/i);
  });
});

describe('projectsFromPackageListJson', () => {
  it('builds a Project[] from the net8 fixture (top-level only)', () => {
    const data = parsePackageListJson(loadFixture('net8-installed.json'));
    const projects = projectsFromPackageListJson(data);

    expect(projects).toHaveLength(1);
    const p = projects[0]!;
    expect(p.name).toBe('TestApp');
    expect(p.targetFrameworks).toEqual(['net8.0']);
    expect(p.packages).toHaveLength(13);

    // Sort is by id ascending — first should be AutoMapper.
    expect(p.packages[0]?.id).toBe('AutoMapper');
    expect(p.packages[0]?.requestedVersion).toBe('12.0.1');
    expect(p.packages[0]?.resolvedVersion).toBe('12.0.1');
    expect(p.packages[0]?.isTransitive).toBe(false);

    // No transitives included by default.
    expect(p.packages.every((pkg) => !pkg.isTransitive)).toBe(true);
  });

  it('includes transitives when requested', () => {
    const data = parsePackageListJson(loadFixture('net8-installed-with-transitive.json'));
    const projects = projectsFromPackageListJson(data, { includeTransitive: true });

    const topLevelCount = projects[0]!.packages.filter((p) => !p.isTransitive).length;
    const transitiveCount = projects[0]!.packages.filter((p) => p.isTransitive).length;

    expect(topLevelCount).toBe(13);
    expect(transitiveCount).toBeGreaterThan(0);
  });

  it('falls back to resolvedVersion when requestedVersion is missing (transitives)', () => {
    const synthetic: DotnetPackageListJson = {
      version: 1,
      parameters: '',
      projects: [
        {
          path: '/x/Foo.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              transitivePackages: [{ id: 'TransOnly', resolvedVersion: '1.2.3' }],
            },
          ],
        },
      ],
    };

    const projects = projectsFromPackageListJson(synthetic, { includeTransitive: true });
    expect(projects[0]?.packages[0]?.requestedVersion).toBe('1.2.3');
    expect(projects[0]?.packages[0]?.isTransitive).toBe(true);
  });

  it('collects all target frameworks across multi-targeted entries', () => {
    const synthetic: DotnetPackageListJson = {
      version: 1,
      parameters: '',
      projects: [
        {
          path: '/x/Multi.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              topLevelPackages: [{ id: 'Pkg', requestedVersion: '1.0.0', resolvedVersion: '1.0.0' }],
            },
            {
              framework: 'net9.0',
              topLevelPackages: [{ id: 'Pkg', requestedVersion: '1.0.0', resolvedVersion: '1.0.0' }],
            },
          ],
        },
      ],
    };

    const projects = projectsFromPackageListJson(synthetic);
    expect(projects[0]?.targetFrameworks).toEqual(['net8.0', 'net9.0']);
    // Same package appearing in both frameworks should dedupe.
    expect(projects[0]?.packages).toHaveLength(1);
  });

  it('prefers top-level over transitive when a package appears as both', () => {
    const synthetic: DotnetPackageListJson = {
      version: 1,
      parameters: '',
      projects: [
        {
          path: '/x/Mixed.csproj',
          frameworks: [
            {
              framework: 'net8.0',
              topLevelPackages: [{ id: 'Shared', requestedVersion: '1.0', resolvedVersion: '1.0' }],
              transitivePackages: [{ id: 'Shared', resolvedVersion: '1.0' }],
            },
          ],
        },
      ],
    };

    const projects = projectsFromPackageListJson(synthetic, { includeTransitive: true });
    const shared = projects[0]?.packages.find((p) => p.id === 'Shared');
    expect(shared?.isTransitive).toBe(false);
  });

  it('handles a project with no frameworks (unrestored)', () => {
    const synthetic: DotnetPackageListJson = {
      version: 1,
      parameters: '',
      projects: [{ path: '/x/Empty.csproj' }],
    };

    const projects = projectsFromPackageListJson(synthetic);
    expect(projects[0]?.packages).toHaveLength(0);
    expect(projects[0]?.targetFrameworks).toHaveLength(0);
  });

  it('derives project name from path on both / and \\ separators', () => {
    const synthetic: DotnetPackageListJson = {
      version: 1,
      parameters: '',
      projects: [
        { path: 'C:\\code\\Foo\\Bar.csproj' },
        { path: '/home/user/Baz.fsproj' },
      ],
    };

    const projects = projectsFromPackageListJson(synthetic);
    expect(projects.find((p) => p.path.endsWith('Bar.csproj'))?.name).toBe('Bar');
    expect(projects.find((p) => p.path.endsWith('Baz.fsproj'))?.name).toBe('Baz');
  });
});
