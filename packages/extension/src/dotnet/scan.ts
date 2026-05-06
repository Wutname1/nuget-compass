import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Project } from '@nuget-compass/shared';
import { listPackages, projectsFromPackageListJson } from './packageList.js';
import { logger } from '../logging/logger.js';

export interface ScanResult {
  projects: Project[];
  errors: ScanError[];
}

export interface ScanError {
  projectPath: string;
  message: string;
}

/**
 * Discover all .NET project files in the workspace and load their installed
 * packages via `dotnet package list`.
 *
 * Each project is scanned independently. A failure on one project (e.g. a
 * malformed csproj) does not block the rest — the failure is collected in
 * `errors[]` and the panel can surface it to the user.
 */
export async function scanWorkspace(options: { includeTransitive?: boolean } = {}): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { projects: [], errors: [] };
  }

  const projectFiles = await findProjectFiles();
  if (projectFiles.length === 0) {
    return { projects: [], errors: [] };
  }

  logger.info(`scanWorkspace: found ${projectFiles.length} project file(s)`);

  const results = await Promise.all(
    projectFiles.map(async (uri): Promise<{ projects: Project[]; error?: ScanError }> => {
      try {
        const cwd = path.dirname(uri.fsPath);
        const json = await listPackages(uri.fsPath, cwd, {
          includeTransitive: options.includeTransitive,
        });
        const projects = projectsFromPackageListJson(json, options);
        // Decorate with CPM and lock-file detection (filesystem walks).
        await Promise.all(projects.map(decorateProjectMetadata));
        return { projects };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`scan failed for ${uri.fsPath}: ${message}`);
        return { projects: [], error: { projectPath: uri.fsPath, message } };
      }
    }),
  );

  const projects: Project[] = [];
  const errors: ScanError[] = [];
  for (const r of results) {
    projects.push(...r.projects);
    if (r.error) errors.push(r.error);
  }

  // Deterministic ordering: by file basename then full path.
  projects.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

  return { projects, errors };
}

async function findProjectFiles(): Promise<vscode.Uri[]> {
  const pattern = '**/*.{csproj,fsproj,vbproj}';
  const exclude = '**/{node_modules,bin,obj,.git}/**';
  return vscode.workspace.findFiles(pattern, exclude);
}

/**
 * Walk up from the project directory looking for a Directory.Packages.props.
 * Sets `centralPackageManagement` if found within the workspace root, and
 * `lockFilePath` if a packages.lock.json exists alongside the project.
 */
async function decorateProjectMetadata(project: Project): Promise<void> {
  const projectDir = path.dirname(project.path);
  const lockPath = path.join(projectDir, 'packages.lock.json');
  if (await fileExists(lockPath)) {
    project.lockFilePath = lockPath;
  }

  const propsPath = await findCentralPackagesProps(projectDir);
  if (propsPath) {
    project.centralPackageManagement = { propsPath };
  }
}

async function findCentralPackagesProps(startDir: string): Promise<string | undefined> {
  // MSBuild's resolution walks ancestors until either a Directory.Build.props
  // sets ManagePackageVersionsCentrally or a Directory.Packages.props is found.
  // We look for the props file directly; if MSBuild semantics ever drift, the
  // SDK's package list output remains the source of truth for resolved versions.
  let current = path.resolve(startDir);
  let safety = 16;
  while (safety-- > 0) {
    const candidate = path.join(current, 'Directory.Packages.props');
    if (await fileExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
