import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  HostMessage,
  PackageRow,
  Project,
  ViewMessage,
  FilterState,
} from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';
import { logger } from '../logging/logger.js';
import { scanWorkspace } from '../dotnet/scan.js';
import { DotnetNotFoundError } from '../dotnet/exec.js';
import { createCatalogClient, type NuGetCatalogClient } from '../nuget/catalogClient.js';
import { resolveAvailableVersions, resolveNewestAllowed } from '../nuget/versionResolver.js';
import { scanVulnerabilities } from '../dotnet/vulnerable.js';
import { scanDeprecations } from '../dotnet/deprecated.js';
import { addPackage } from '../dotnet/addPackage.js';
import { removePackage } from '../dotnet/removePackage.js';
import { searchPackages } from '../dotnet/searchPackages.js';
import { listSources } from '../dotnet/listSources.js';

export class PackagesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'nuget-compass.packages';

  private view: vscode.WebviewView | undefined;
  private readonly catalog: NuGetCatalogClient;
  /** Last scan result, kept so expand handlers can find the project for a path. */
  private lastProjects: Project[] = [];
  /** Rows produced by the most recent enrichment, per project path. Drives Update All. */
  private readonly lastRowsByProject = new Map<string, PackageRow[]>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.catalog = createCatalogClient(context);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: ViewMessage) => {
      this.handleViewMessage(msg);
    });
  }

  refresh(): void {
    void this.runRefresh();
  }

  async forceRefresh(): Promise<void> {
    // Invalidate the catalog cache for every package visible in the last
    // scan, then re-run the scan. Fresh installs read from nuget.org.
    const packageIds = new Set<string>();
    for (const project of this.lastProjects) {
      for (const pkg of project.packages) packageIds.add(pkg.id);
    }
    await Promise.all(Array.from(packageIds).map((id) => this.catalog.invalidate(id)));
    logger.info(`force refresh: invalidated ${packageIds.size} package(s) in catalog cache`);
    this.refresh();
  }

  private async runRefresh(): Promise<void> {
    this.post({ type: 'host:status', status: 'scanning' });
    const filters = this.loadFilters();
    try {
      const result = await scanWorkspace({ includeTransitive: filters.showTransitive });
      this.lastProjects = result.projects;
      this.lastRowsByProject.clear();
      this.post({ type: 'host:projects', projects: result.projects });

      // Surface NuGet sources alongside the project list. Best-effort; if it
      // fails (e.g. dotnet missing) we already showed a banner during scan.
      const cwd = result.projects[0] ? path.dirname(result.projects[0].path) : undefined;
      if (cwd) {
        listSources(cwd)
          .then((sources) => this.post({ type: 'host:sources', sources }))
          .catch((err: unknown) => logger.warn(`listSources failed: ${describeReason(err)}`));
      }

      // First paint: send rows without newestAllowed so the UI shows packages
      // immediately. enrichProject fills in newestAllowed + badges in the
      // background.
      for (const project of result.projects) {
        const rows: PackageRow[] = project.packages
          .filter((p) => filters.showTransitive || !p.isTransitive)
          .map((pkg) => ({ projectPath: project.path, package: pkg }));
        this.post({ type: 'host:packageRows', projectPath: project.path, rows });
        this.post({
          type: 'host:projectStatus',
          projectPath: project.path,
          status: 'enriching',
          progress: { done: 0, total: rows.length },
        });
      }

      if (result.errors.length > 0) {
        const detail = result.errors.map((e) => `${e.projectPath}: ${e.message}`).join('\n');
        this.post({
          type: 'host:error',
          message: `Scan completed with ${result.errors.length} error(s).`,
          detail,
        });
      }

      // Second paint: enrich with newestAllowed (target-framework aware via
      // the catalog) plus vulnerability and deprecation badges from the SDK.
      this.post({ type: 'host:status', status: 'fetching' });
      await Promise.all(
        result.projects.map((project) => this.enrichProject(project, filters)),
      );
    } catch (err) {
      if (err instanceof DotnetNotFoundError) {
        this.post({ type: 'host:error', message: err.message });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('refresh failed', err);
        this.post({ type: 'host:error', message: 'Scan failed.', detail: message });
      }
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }
  }

  private async enrichProject(project: Project, filters: FilterState): Promise<void> {
    const cwd = path.dirname(project.path);

    // Vulnerability + deprecation scans come from the SDK and are accurate.
    // newestAllowed comes from the catalog (target-framework aware) per package.
    const visiblePackages = project.packages.filter(
      (p) => filters.showTransitive || !p.isTransitive,
    );

    this.post({
      type: 'host:projectStatus',
      projectPath: project.path,
      status: 'enriching',
      progress: { done: 0, total: visiblePackages.length },
    });

    let done = 0;
    const reportProgress = (): void => {
      done++;
      // Throttle progress messages to avoid spamming the webview.
      if (done === visiblePackages.length || done % 5 === 0) {
        this.post({
          type: 'host:projectStatus',
          projectPath: project.path,
          status: 'enriching',
          progress: { done, total: visiblePackages.length },
        });
      }
    };

    const [vulnsResult, depsResult, newestResults] = await Promise.allSettled([
      scanVulnerabilities(project.path, cwd),
      scanDeprecations(project.path, cwd),
      Promise.all(
        visiblePackages.map(async (pkg) => {
          try {
            const newest = await resolveNewestAllowed({
              packageId: pkg.id,
              currentVersion: pkg.resolvedVersion,
              projectTargetFrameworks: project.targetFrameworks,
              filters,
              catalog: this.catalog,
            });
            return [pkg.id, newest] as const;
          } catch (err) {
            logger.warn(
              `newestAllowed lookup failed for ${pkg.id}: ${describeReason(err)}`,
            );
            return [pkg.id, undefined] as const;
          } finally {
            reportProgress();
          }
        }),
      ),
    ]);

    const newestById = new Map<string, string | undefined>();
    if (newestResults.status === 'fulfilled') {
      for (const [id, ver] of newestResults.value) newestById.set(id, ver);
    } else {
      logger.warn(
        `catalog enrichment failed for ${project.path}: ${describeReason(newestResults.reason)}`,
      );
    }

    const vulnsByKey =
      vulnsResult.status === 'fulfilled'
        ? vulnsResult.value
        : (logger.warn(
            `vulnerability scan failed for ${project.path}: ${describeReason(vulnsResult.reason)}`,
          ),
          new Map());
    const depsByKey =
      depsResult.status === 'fulfilled'
        ? depsResult.value
        : (logger.warn(
            `deprecation scan failed for ${project.path}: ${describeReason(depsResult.reason)}`,
          ),
          new Map());

    const rows: PackageRow[] = visiblePackages.map((pkg) => {
      const key = `${project.path}::${pkg.id}`;
      const row: PackageRow = { projectPath: project.path, package: pkg };
      const newest = newestById.get(pkg.id);
      if (newest !== undefined) row.newestAllowed = newest;
      const vulns = vulnsByKey.get(key);
      if (vulns) row.vulnerability = vulns;
      const dep = depsByKey.get(key);
      if (dep) row.deprecation = dep;
      return row;
    });

    this.lastRowsByProject.set(project.path, rows);
    this.post({ type: 'host:packageRows', projectPath: project.path, rows });
    this.post({ type: 'host:projectStatus', projectPath: project.path, status: 'ready' });
  }

  private async expandPackage(projectPath: string, packageId: string): Promise<void> {
    const project = this.lastProjects.find((p) => p.path === projectPath);
    if (!project) {
      logger.warn(`expandPackage: unknown project ${projectPath}`);
      return;
    }
    const pkg = project.packages.find((x) => x.id === packageId);
    if (!pkg) {
      logger.warn(`expandPackage: ${packageId} not found in ${projectPath}`);
      return;
    }

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      const filters = this.loadFilters();
      const result = await resolveAvailableVersions({
        packageId,
        currentVersion: pkg.resolvedVersion,
        projectTargetFrameworks: project.targetFrameworks,
        filters,
        catalog: this.catalog,
      });
      this.post({
        type: 'host:packageVersions',
        projectPath,
        packageId,
        versions: result.versions,
        newestAllowed: result.newestAllowed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`expandPackage failed for ${packageId}: ${message}`);
      this.post({
        type: 'host:error',
        message: `Could not load versions for ${packageId}.`,
        detail: message,
      });
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }
  }

  private handleViewMessage(msg: ViewMessage): void {
    logger.trace(`view → host: ${msg.type}`);
    switch (msg.type) {
      case 'view:ready':
        this.post({ type: 'host:init', filters: this.loadFilters() });
        this.refresh();
        return;
      case 'view:refresh':
        if (msg.forceCacheBust) void this.forceRefresh();
        else this.refresh();
        return;
      case 'view:setFilters':
        void this.saveFilters(msg.filters);
        return;
      case 'view:expandPackage':
        void this.expandPackage(msg.projectPath, msg.packageId);
        return;
      case 'view:updatePackage':
        void this.updatePackage(msg.projectPath, msg.packageId, msg.toVersion);
        return;
      case 'view:updateAll':
        void this.updateAll(msg.projectPath);
        return;
      case 'view:uninstallPackage':
        void this.uninstallPackage(msg.projectPath, msg.packageId);
        return;
      case 'view:searchPackages':
        void this.runSearch(msg.query);
        return;
      case 'view:installPackage':
        void this.installPackage(msg.projectPath, msg.packageId, msg.version);
        return;
    }
  }

  private async updatePackage(
    projectPath: string,
    packageId: string,
    toVersion: string,
  ): Promise<void> {
    const project = this.lastProjects.find((p) => p.path === projectPath);
    if (!project) {
      logger.warn(`updatePackage: unknown project ${projectPath}`);
      return;
    }
    const pkg = project.packages.find((x) => x.id === packageId);
    if (!pkg) {
      logger.warn(`updatePackage: ${packageId} not found in ${projectPath}`);
      return;
    }

    const promptDetail = pkg.isTransitive
      ? `${packageId} is currently a transitive dependency at ${pkg.resolvedVersion}. ` +
        `Installing ${toVersion} adds it as a top-level <PackageReference>, pinning it across restores. Continue?`
      : `Update ${packageId} from ${pkg.resolvedVersion} to ${toVersion}?`;
    const choice = await vscode.window.showInformationMessage(
      promptDetail,
      { modal: true },
      pkg.isTransitive ? 'Pin' : 'Update',
    );
    if (choice !== 'Update' && choice !== 'Pin') return;

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      const result = await addPackage(
        projectPath,
        path.dirname(projectPath),
        packageId,
        toVersion,
      );
      if (!result.success) {
        logger.error(`update failed: ${result.output}`);
        this.post({
          type: 'host:error',
          message: `Could not update ${packageId} to ${toVersion}.`,
          detail: result.output,
        });
        // Surface the SDK output channel so the user can see NU-codes inline.
        logger.show();
        return;
      }
      logger.info(`updated ${packageId} -> ${toVersion}`);
      void vscode.window.showInformationMessage(`Updated ${packageId} to ${toVersion}.`);
      // Re-scan to reflect the new resolvedVersion. Cheaper than refreshing
      // the whole workspace, but using the existing path keeps the code small.
      this.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('updatePackage failed', err);
      this.post({
        type: 'host:error',
        message: `Could not update ${packageId}.`,
        detail: message,
      });
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }
  }

  private async updateAll(projectPath: string): Promise<void> {
    const project = this.lastProjects.find((p) => p.path === projectPath);
    if (!project) return;
    const rows = (this.lastRowsByProject.get(projectPath) ?? []).filter(
      (r) => r.newestAllowed && r.newestAllowed !== r.package.resolvedVersion,
    );
    if (rows.length === 0) {
      void vscode.window.showInformationMessage('No updates available.');
      return;
    }
    const summary = rows
      .map((r) => `  ${r.package.id}: ${r.package.resolvedVersion} -> ${r.newestAllowed!}`)
      .join('\n');

    // The modal truncates long lists; mirror the full plan to the output
    // channel so power users can review every change.
    logger.info(`Update All preview for ${project.name}:\n${summary}`);

    const previewLines = rows.length > 10 ? `${rows.slice(0, 10).map((r) => `  ${r.package.id}: ${r.package.resolvedVersion} -> ${r.newestAllowed!}`).join('\n')}\n  …and ${rows.length - 10} more (see "Compass: NuGet" output channel)` : summary;
    const choice = await vscode.window.showInformationMessage(
      `Update ${rows.length} package(s) in ${project.name}?\n\n${previewLines}`,
      { modal: true },
      'Update All',
    );
    if (choice !== 'Update All') return;

    this.post({ type: 'host:status', status: 'fetching' });
    const failures: string[] = [];
    try {
      // Sequential to avoid SDK contention on the same project file.
      for (const row of rows) {
        const result = await addPackage(
          projectPath,
          path.dirname(projectPath),
          row.package.id,
          row.newestAllowed!,
        );
        if (!result.success) {
          failures.push(`${row.package.id} -> ${row.newestAllowed!}: ${firstLine(result.output)}`);
          logger.error(`updateAll: ${row.package.id} failed: ${result.output}`);
        } else {
          logger.info(`updateAll: ${row.package.id} -> ${row.newestAllowed!}`);
        }
      }
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }

    if (failures.length === 0) {
      void vscode.window.showInformationMessage(
        `Updated ${rows.length} package(s) in ${project.name}.`,
      );
    } else {
      this.post({
        type: 'host:error',
        message: `${failures.length} of ${rows.length} updates failed.`,
        detail: failures.join('\n'),
      });
      logger.show();
    }
    this.refresh();
  }

  private async uninstallPackage(projectPath: string, packageId: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `Uninstall ${packageId} from this project?`,
      { modal: true },
      'Uninstall',
    );
    if (choice !== 'Uninstall') return;

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      const result = await removePackage(projectPath, path.dirname(projectPath), packageId);
      if (!result.success) {
        this.post({
          type: 'host:error',
          message: `Could not uninstall ${packageId}.`,
          detail: result.output,
        });
        logger.show();
        return;
      }
      void vscode.window.showInformationMessage(`Uninstalled ${packageId}.`);
      this.refresh();
    } catch (err) {
      this.post({
        type: 'host:error',
        message: `Could not uninstall ${packageId}.`,
        detail: describeReason(err),
      });
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }
  }

  private async runSearch(query: string): Promise<void> {
    if (query.trim().length === 0) {
      this.post({ type: 'host:searchResults', query, results: [] });
      return;
    }
    const cwd = this.firstProjectCwd();
    if (!cwd) {
      this.post({ type: 'host:error', message: 'Open a .NET project before searching.' });
      return;
    }
    try {
      const hits = await searchPackages(query, cwd);
      this.post({ type: 'host:searchResults', query, results: hits });
    } catch (err) {
      logger.warn(`search failed: ${describeReason(err)}`);
      this.post({
        type: 'host:error',
        message: 'Search failed.',
        detail: describeReason(err),
      });
    }
  }

  private async installPackage(
    projectPath: string,
    packageId: string,
    version?: string,
  ): Promise<void> {
    const project = this.lastProjects.find((p) => p.path === projectPath);
    if (!project) return;
    const verLabel = version ? ` ${version}` : '';
    const choice = await vscode.window.showInformationMessage(
      `Install ${packageId}${verLabel} to ${project.name}?`,
      { modal: true },
      'Install',
    );
    if (choice !== 'Install') return;

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      const args: Parameters<typeof addPackage> = [
        projectPath,
        path.dirname(projectPath),
        packageId,
        version ?? '',
      ];
      // addPackage requires a version; if none supplied, omit the --version arg.
      // Easiest path: call dotnet directly when version is omitted.
      const { runDotnet } = await import('../dotnet/exec.js');
      const result = version
        ? await addPackage(...args)
        : await (async () => {
            const r = await runDotnet(
              ['add', projectPath, 'package', packageId],
              path.dirname(projectPath),
              60_000,
            );
            return {
              success: r.code === 0,
              output: [r.stdout, r.stderr].filter((s) => s.trim().length > 0).join('\n'),
            };
          })();
      if (!result.success) {
        this.post({
          type: 'host:error',
          message: `Could not install ${packageId}.`,
          detail: result.output,
        });
        logger.show();
        return;
      }
      void vscode.window.showInformationMessage(`Installed ${packageId}${verLabel}.`);
      this.refresh();
    } catch (err) {
      this.post({
        type: 'host:error',
        message: `Could not install ${packageId}.`,
        detail: describeReason(err),
      });
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }
  }

  private firstProjectCwd(): string | undefined {
    const first = this.lastProjects[0];
    return first ? path.dirname(first.path) : undefined;
  }

  private post(message: HostMessage): void {
    logger.trace(`host → view: ${message.type}`);
    void this.view?.webview.postMessage(message);
  }

  private loadFilters(): FilterState {
    const cfg = vscode.workspace.getConfiguration('nuget-compass');
    return {
      tfm: cfg.get<FilterState['tfm']>('tfmFilter') ?? defaultFilterState.tfm,
      updateLevel:
        cfg.get<FilterState['updateLevel']>('updateLevel') ?? defaultFilterState.updateLevel,
      includePrerelease:
        cfg.get<boolean>('includePrerelease') ?? defaultFilterState.includePrerelease,
      showTransitive: cfg.get<boolean>('showTransitive') ?? defaultFilterState.showTransitive,
    };
  }

  private async saveFilters(filters: FilterState): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('nuget-compass');
    await Promise.all([
      cfg.update('tfmFilter', filters.tfm, vscode.ConfigurationTarget.Workspace),
      cfg.update('updateLevel', filters.updateLevel, vscode.ConfigurationTarget.Workspace),
      cfg.update(
        'includePrerelease',
        filters.includePrerelease,
        vscode.ConfigurationTarget.Workspace,
      ),
      cfg.update('showTransitive', filters.showTransitive, vscode.ConfigurationTarget.Workspace),
    ]);
  }

  private renderHtml(webview: vscode.Webview): string {
    const webviewDir = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const indexPath = path.join(webviewDir.fsPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return this.renderFallbackHtml(
        'Webview bundle not found. Run `pnpm build` to produce `dist/webview/`.',
      );
    }

    let html = fs.readFileSync(indexPath, 'utf8');
    const nonce = generateNonce();

    // Rewrite asset paths to webview URIs and inject CSP.
    html = html.replace(/(src|href)="(\/[^"]+)"/g, (_match, attr: string, urlPath: string) => {
      const assetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(webviewDir, urlPath.replace(/^\//, '')),
      );
      return `${attr}="${assetUri.toString()}"`;
    });

    // Inject nonce into <script> tags so they pass CSP.
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `connect-src https://api.nuget.org`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    html = html.replace(
      /<head>/,
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );

    return html;
  }

  private renderFallbackHtml(message: string): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>NuGet Compass</title></head>
<body style="font-family:var(--vscode-font-family);padding:1rem;color:var(--vscode-foreground);">
  <h2>NuGet Compass</h2>
  <p>${escapeHtml(message)}</p>
</body></html>`;
  }
}

function describeReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i === -1 ? s : s.slice(0, i);
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
