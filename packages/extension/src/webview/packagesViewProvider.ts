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
import { scanVulnerabilities, type VulnerabilitiesByPackage } from '../dotnet/vulnerable.js';
import { scanDeprecations, type DeprecationsByPackage } from '../dotnet/deprecated.js';
import { addPackage } from '../dotnet/addPackage.js';
import { removePackage } from '../dotnet/removePackage.js';
import {
  parseDiagnosticsFromOutput,
  dedupeDiagnostics,
  type NuDiagnostic,
  type NuFix,
} from '../dotnet/diagnostics.js';
import { searchPackages } from '../dotnet/searchPackages.js';
import { listSources } from '../dotnet/listSources.js';
import {
  addSource,
  removeSource,
  enableSource,
  disableSource,
} from '../dotnet/sources.js';
import { CredentialVault } from '../dotnet/credentialVault.js';

export class PackagesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'nuget-compass.packages';

  private view: vscode.WebviewView | undefined;
  private readonly catalog: NuGetCatalogClient;
  private readonly vault: CredentialVault;
  /** Last scan result, kept so expand handlers can find the project for a path. */
  private lastProjects: Project[] = [];
  /** Rows produced by the most recent enrichment, per project path. Drives Update All. */
  private readonly lastRowsByProject = new Map<string, PackageRow[]>();
  /** Last sources surfaced to the webview, with auth-failure flags. */
  private lastSources: {
    name: string;
    url: string;
    enabled: boolean;
    credentialStore: 'nuget-config' | 'vscode-secrets' | 'none';
    authFailed?: boolean;
  }[] = [];
  /** Serializes mutating `dotnet` invocations (add/remove) so concurrent bulk
   *  updates don't race each other or an in-flight scan. */
  private mutationQueue: Promise<unknown> = Promise.resolve();
  /** In-flight count of queued mutations; while > 0, refresh() is deferred. */
  private pendingMutations = 0;
  /** Set when a refresh was requested while mutations were in flight. */
  private refreshPending = false;
  /** Most recent diagnostics emitted to the view; reused when suppression toggles. */
  private lastDiagnostics: NuDiagnostic[] = [];

  /** Workspace-state key for the user's "don't show this code again" list. */
  private static readonly suppressedCodesKey = 'nuget-compass.suppressedDiagnosticCodes';

  constructor(private readonly context: vscode.ExtensionContext) {
    this.catalog = createCatalogClient(context);
    this.vault = new CredentialVault(context.secrets);
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
    if (this.pendingMutations > 0) {
      this.refreshPending = true;
      return;
    }
    void this.runRefresh();
  }

  /**
   * Run a mutating dotnet operation (add/remove/install) serialized against
   * every other mutation. This prevents concurrent .csproj/lockfile writes
   * from corrupting each other and from racing an in-flight workspace scan
   * (which would surface as "dotnet package list JSON did not match expected
   * schema" errors).
   */
  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    this.pendingMutations += 1;
    const next = this.mutationQueue.then(fn, fn);
    this.mutationQueue = next.catch(() => {
      /* errors handled by caller */
    });
    return next.finally(() => {
      this.pendingMutations -= 1;
      if (this.pendingMutations === 0 && this.refreshPending) {
        this.refreshPending = false;
        void this.runRefresh();
      }
    });
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
      // Resolve the current source list first so we know which env vars to
      // inject (SecretStorage credentials feed in via NuGetPackageSourceCredentials_<NAME>).
      const cwdProbe = this.probeCwd();
      const sources = cwdProbe ? await listSources(cwdProbe) : [];
      const extraEnv = await this.vault.buildEnv(sources.map((s) => s.name));

      // Always fetch transitives. The webview filters them per the user's
      // current "Show transitive" toggle without needing a refetch.
      const timeoutMs = this.dotnetCommandTimeoutMs();
      const result = await scanWorkspace({
        includeTransitive: true,
        extraEnv,
        timeoutMs,
      });
      this.lastProjects = result.projects;
      this.lastRowsByProject.clear();
      this.post({ type: 'host:projects', projects: result.projects });

      // Surface NuGet sources alongside the project list, decorated with
      // credential-store info and any auth failures we sniffed from the scan.
      await this.publishSources(sources, result.rawOutputs);

      // First paint: send all rows including transitive. The webview filters
      // them in-memory per the user's current "Show transitive" toggle.
      for (const project of result.projects) {
        const rows: PackageRow[] = project.packages.map((pkg) => ({
          projectPath: project.path,
          package: pkg,
        }));
        this.post({ type: 'host:packageRows', projectPath: project.path, rows });
        const enrichTotal = rows.filter((r) => !r.package.isTransitive).length;
        this.post({
          type: 'host:projectStatus',
          projectPath: project.path,
          status: 'enriching',
          progress: { done: 0, total: enrichTotal },
        });
      }

      // Structured diagnostics replace the legacy single-blob error banner.
      // We only fall back to host:error for catastrophic scan failures (e.g.
      // dotnet missing) below in the catch block.
      this.lastDiagnostics = result.diagnostics;
      this.post({
        type: 'host:diagnostics',
        diagnostics: result.diagnostics,
        suppressedCodes: this.suppressedCodes(),
      });

      // Per-project hard failures (e.g. timeout) still surface as a one-line
      // error banner so the user knows the scan is incomplete.
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
    // We only enrich top-level packages; transitives don't need newestAllowed
    // since they aren't directly upgradeable. The "Show transitive" toggle
    // is purely visual now and the webview filters in-memory.
    const visiblePackages = project.packages.filter((p) => !p.isTransitive);

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

    const timeoutMs = this.dotnetCommandTimeoutMs();
    const [vulnsResult, depsResult, newestResults] = await Promise.allSettled([
      scanVulnerabilities(project.path, cwd, { timeoutMs }),
      scanDeprecations(project.path, cwd, { timeoutMs }),
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

    let vulnsByKey: VulnerabilitiesByPackage;
    if (vulnsResult.status === 'fulfilled') {
      vulnsByKey = vulnsResult.value;
    } else {
      logger.warn(
        `vulnerability scan failed for ${project.path}: ${describeReason(vulnsResult.reason)}`,
      );
      vulnsByKey = new Map();
    }
    let depsByKey: DeprecationsByPackage;
    if (depsResult.status === 'fulfilled') {
      depsByKey = depsResult.value;
    } else {
      logger.warn(
        `deprecation scan failed for ${project.path}: ${describeReason(depsResult.reason)}`,
      );
      depsByKey = new Map();
    }

    // Build enriched rows for top-level packages, plus pass-through rows
    // for transitives so the user can still see them when "Show transitive"
    // is toggled on. Transitives don't get vuln/deprec/newestAllowed - those
    // signals attach to top-level pins.
    const rows: PackageRow[] = project.packages.map((pkg) => {
      const key = `${project.path}::${pkg.id}`;
      const row: PackageRow = { projectPath: project.path, package: pkg };
      if (!pkg.isTransitive) {
        const newest = newestById.get(pkg.id);
        if (newest !== undefined) row.newestAllowed = newest;
        const vulns = vulnsByKey.get(key);
        if (vulns) row.vulnerability = vulns;
        const dep = depsByKey.get(key);
        if (dep) row.deprecation = dep;
      }
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
        this.post({
          type: 'host:init',
          filters: this.loadFilters(),
          fontScale: this.loadFontScale(),
        });
        this.refresh();
        return;
      case 'view:refresh':
        if (msg.forceCacheBust) void this.forceRefresh();
        else this.refresh();
        return;
      case 'view:setFilters':
        void this.applyFilterChange(msg.filters);
        return;
      case 'view:expandPackage':
        void this.expandPackage(msg.projectPath, msg.packageId);
        return;
      case 'view:updatePackage':
        void this.updatePackage(msg.projectPath, msg.packageId, msg.toVersion, msg.confirmed);
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
      case 'view:addSource':
        void this.handleAddSource(
          msg.name,
          msg.url,
          msg.username,
          msg.password,
          msg.credentialStore ?? 'nuget-config',
          Boolean(msg.reauth),
        );
        return;
      case 'view:removeSource':
        void this.handleRemoveSource(msg.name);
        return;
      case 'view:toggleSource':
        void this.handleToggleSource(msg.name, msg.enabled);
        return;
      case 'view:fetchReadme':
        void this.handleFetchReadme(msg.packageId, msg.version, msg.readmeUrl);
        return;
      case 'view:openSettings':
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:wutname1.nuget-compass',
        );
        return;
      case 'view:applyDiagnosticFix':
        void this.applyDiagnosticFix(msg.key, msg.fix);
        return;
      case 'view:suppressDiagnosticCode':
        void this.setSuppressed(msg.code, msg.suppressed);
        return;
      case 'view:revealPackage':
        // No-op on the host side; the webview owns selection. The message
        // exists for parity (e.g. NU1701 "Show in list" fix) so future
        // versions can scroll/focus the row from the host if needed.
        return;
    }
  }

  private async updatePackage(
    projectPath: string,
    packageId: string,
    toVersion: string,
    confirmed?: boolean,
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

    if (!confirmed) {
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
    }

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      const result = await this.enqueueMutation(() =>
        addPackage(projectPath, path.dirname(projectPath), packageId, toVersion),
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
      // Refresh is deferred until every queued mutation drains, so a bulk
      // update produces one workspace scan rather than N racing scans.
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
        const result = await this.enqueueMutation(() =>
          addPackage(
            projectPath,
            path.dirname(projectPath),
            row.package.id,
            row.newestAllowed!,
          ),
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
      const result = await this.enqueueMutation(() =>
        removePackage(projectPath, path.dirname(projectPath), packageId),
      );
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

  private suppressedCodes(): string[] {
    return this.context.workspaceState.get<string[]>(PackagesViewProvider.suppressedCodesKey, []);
  }

  private async setSuppressed(code: string, suppressed: boolean): Promise<void> {
    const current = new Set(this.suppressedCodes());
    if (suppressed) current.add(code);
    else current.delete(code);
    await this.context.workspaceState.update(
      PackagesViewProvider.suppressedCodesKey,
      Array.from(current),
    );
    // Re-publish so the webview applies the new suppression list immediately.
    this.post({
      type: 'host:diagnostics',
      diagnostics: this.lastDiagnostics,
      suppressedCodes: Array.from(current),
    });
  }

  /**
   * Apply a diagnostic fix. NU1605 cascades — pinning A may surface a fresh
   * NU1605 against B. We follow that chain up to a small bound and detect
   * cycles, falling back to a "manual intervention" message when the SDK
   * keeps disagreeing with itself.
   */
  private async applyDiagnosticFix(key: string, fix: NuFix): Promise<void> {
    if (fix.kind === 'reveal-package') {
      // Pure UI hint; nothing to do on the host.
      this.post({
        type: 'host:fixResult',
        key,
        success: true,
        message: `Located ${fix.packageId}.`,
      });
      return;
    }

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      if (fix.kind === 'pin-package') {
        const outcome = await this.applyPinChain(fix);
        this.post({ type: 'host:fixResult', ...outcome, key });
      } else if (fix.kind === 'remove-package') {
        const result = await this.enqueueMutation(() =>
          removePackage(fix.projectPath, path.dirname(fix.projectPath), fix.packageId),
        );
        if (!result.success) {
          this.post({
            type: 'host:fixResult',
            key,
            success: false,
            message: `Could not remove ${fix.packageId}: ${firstLine(result.output)}`,
          });
          logger.show();
          return;
        }
        this.post({
          type: 'host:fixResult',
          key,
          success: true,
          message: `Removed ${fix.packageId}.`,
        });
      } else if (fix.kind === 'update-package') {
        // Vulnerable/deprecated: jump the user to the package in-list so they
        // pick a safe version. We don't auto-pick because the right floor
        // depends on the advisory.
        this.post({
          type: 'host:fixResult',
          key,
          success: true,
          message: `Open ${fix.packageId} to select a fixed version.`,
        });
      }
    } catch (err) {
      logger.error('applyDiagnosticFix failed', err);
      this.post({
        type: 'host:fixResult',
        key,
        success: false,
        message: describeReason(err),
      });
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
      this.refresh();
    }
  }

  /**
   * Pin a package to a version, then follow any new NU1605 downgrades that
   * pop out of the SDK's output. Bounded to keep us from spinning on a
   * pathological project, and cycle-detects the A↔B case.
   */
  private async applyPinChain(initial: {
    projectPath: string;
    packageId: string;
    version: string;
  }): Promise<{ success: boolean; message: string; manualIntervention?: { reason: string; projects: string[]; packageIds: string[] } }> {
    const MAX_STEPS = 6;
    const visited = new Set<string>();
    const projects = new Set<string>();
    const packageIds = new Set<string>();
    let current = initial;

    for (let step = 0; step < MAX_STEPS; step++) {
      const visitKey = `${current.projectPath}::${current.packageId}`;
      if (visited.has(visitKey)) {
        return {
          success: false,
          message:
            `Pin chain looped on ${current.packageId} in ${path.basename(current.projectPath)}. ` +
            `Edit the .csproj file directly and run "dotnet restore".`,
          manualIntervention: {
            reason: 'Circular package downgrade detected.',
            projects: Array.from(projects),
            packageIds: Array.from(packageIds),
          },
        };
      }
      visited.add(visitKey);
      projects.add(current.projectPath);
      packageIds.add(current.packageId);

      const result = await this.enqueueMutation(() =>
        addPackage(
          current.projectPath,
          path.dirname(current.projectPath),
          current.packageId,
          current.version,
        ),
      );

      if (result.success) {
        if (step === 0) {
          return { success: true, message: `Pinned ${current.packageId} to ${current.version}.` };
        }
        return {
          success: true,
          message:
            `Resolved by pinning ${packageIds.size} package(s) across ${projects.size} project(s).`,
        };
      }

      // The add failed. Parse its output for the next NU1605, if any.
      const followUps = dedupeDiagnostics(
        parseDiagnosticsFromOutput(current.projectPath, result.output),
      ).filter(
        (d) =>
          d.code === 'NU1605' &&
          d.fix?.kind === 'pin-package' &&
          d.packageId &&
          d.fix.version,
      );

      const next = followUps[0]?.fix;
      if (next?.kind !== 'pin-package') {
        // Not a downgrade conflict — surface the SDK error verbatim.
        logger.error(`pin chain stopped: ${result.output}`);
        logger.show();
        return {
          success: false,
          message:
            `Could not pin ${current.packageId} to ${current.version}: ${firstLine(result.output)}`,
        };
      }
      current = {
        projectPath: next.projectPath,
        packageId: next.packageId,
        version: next.version,
      };
    }

    return {
      success: false,
      message:
        `Gave up after ${MAX_STEPS} dependency-chain pins. The .csproj files likely need manual edits.`,
      manualIntervention: {
        reason: 'Pin chain exceeded maximum depth.',
        projects: Array.from(projects),
        packageIds: Array.from(packageIds),
      },
    };
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
      const result = await this.enqueueMutation(() =>
        version
          ? addPackage(...args)
          : (async () => {
              const r = await runDotnet(
                ['add', projectPath, 'package', packageId],
                path.dirname(projectPath),
                60_000,
              );
              return {
                success: r.code === 0,
                output: [r.stdout, r.stderr].filter((s) => s.trim().length > 0).join('\n'),
              };
            })(),
      );
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

  private async handleAddSource(
    name: string,
    url: string,
    username: string | undefined,
    password: string | undefined,
    credentialStore: 'nuget-config' | 'vscode-secrets',
    reauth: boolean,
  ): Promise<void> {
    const cwd = this.firstProjectCwd() ?? process.cwd();

    // Re-auth replaces any existing entry for the same name first.
    if (reauth) {
      await removeSource(cwd, name);
      await this.vault.delete(name);
    }

    const useSecrets = credentialStore === 'vscode-secrets' && Boolean(password);
    // For SecretStorage: register the source without a password in nuget.config;
    // creds are injected via NuGetPackageSourceCredentials_<NAME> env at scan time.
    const result = await addSource(cwd, name, url, {
      username: useSecrets ? undefined : username,
      password: useSecrets ? undefined : password,
      storePasswordInClearText: !useSecrets && Boolean(password),
    });
    if (!result.success) {
      this.post({
        type: 'host:error',
        message: `Could not add source "${name}".`,
        detail: result.output,
      });
      logger.show();
      return;
    }

    if (useSecrets && password) {
      await this.vault.store(name, username ?? '', password);
    } else if (credentialStore === 'nuget-config') {
      // If creds moved to nuget.config, drop any stale vault entry.
      await this.vault.delete(name);
    }

    void vscode.window.showInformationMessage(
      reauth
        ? `Re-authenticated NuGet source "${name}".`
        : `Added NuGet source "${name}".`,
    );
    await this.refreshSources();
  }

  private async handleRemoveSource(name: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `Remove NuGet source "${name}"?`,
      { modal: true },
      'Remove',
    );
    if (choice !== 'Remove') return;
    const cwd = this.firstProjectCwd() ?? process.cwd();
    const result = await removeSource(cwd, name);
    if (!result.success) {
      this.post({
        type: 'host:error',
        message: `Could not remove source "${name}".`,
        detail: result.output,
      });
      logger.show();
      return;
    }
    await this.vault.delete(name);
    await this.refreshSources();
  }

  private async handleToggleSource(name: string, enabled: boolean): Promise<void> {
    const cwd = this.firstProjectCwd() ?? process.cwd();
    const result = enabled ? await enableSource(cwd, name) : await disableSource(cwd, name);
    if (!result.success) {
      this.post({
        type: 'host:error',
        message: `Could not ${enabled ? 'enable' : 'disable'} source "${name}".`,
        detail: result.output,
      });
      logger.show();
      return;
    }
    await this.refreshSources();
  }

  private async refreshSources(): Promise<void> {
    const cwd = this.firstProjectCwd();
    if (!cwd) return;
    try {
      const sources = await listSources(cwd);
      await this.publishSources(sources, []);
    } catch (err) {
      logger.warn(`refreshSources failed: ${describeReason(err)}`);
    }
  }

  /** Returns a usable cwd for `dotnet nuget` commands when no scan has run yet. */
  private probeCwd(): string | undefined {
    const fromScan = this.firstProjectCwd();
    if (fromScan) return fromScan;
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? folder.uri.fsPath : undefined;
  }

  /**
   * Decorate the raw source list with credential-store + auth-failure info and
   * push it to the webview. Emits `host:sourceAuthRequired` for any source that
   * looks like it just 401'd/403'd against its feed.
   */
  private async publishSources(
    rawSources: { name: string; url: string; enabled: boolean }[],
    rawOutputs: string[],
  ): Promise<void> {
    const decorated: typeof this.lastSources = [];
    for (const src of rawSources) {
      const stored = await this.vault.get(src.name);
      const credentialStore: 'nuget-config' | 'vscode-secrets' | 'none' = stored
        ? 'vscode-secrets'
        : 'none'; // We can't reliably know if nuget.config holds a password without parsing it.
      const authFailed = detectAuthFailureForUrl(src.url, rawOutputs);
      decorated.push({ ...src, credentialStore, authFailed });
    }
    this.lastSources = decorated;
    this.post({ type: 'host:sources', sources: decorated });

    for (const src of decorated) {
      if (src.authFailed) {
        this.post({
          type: 'host:sourceAuthRequired',
          name: src.name,
          url: src.url,
          credentialStore: src.credentialStore,
        });
      }
    }
  }

  private async handleFetchReadme(
    packageId: string,
    version: string,
    readmeUrl: string,
  ): Promise<void> {
    void readmeUrl; // The provided URL points at nuget.org's HTML page; we use the
    // flat-container endpoint instead to get the raw README markdown.
    const flatContainerUrl =
      `https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(
        packageId.toLowerCase(),
      )}/${encodeURIComponent(version)}/readme`;
    try {
      logger.trace(`HTTP GET ${flatContainerUrl}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(flatContainerUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'nuget-compass (+vscode-extension)' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        this.post({
          type: 'host:readme',
          packageId,
          version,
          body: '',
          contentType: 'error',
          errorMessage: `HTTP ${response.status}`,
        });
        return;
      }
      const text = await response.text();
      this.post({ type: 'host:readme', packageId, version, body: text, contentType: 'markdown' });
    } catch (err) {
      this.post({
        type: 'host:readme',
        packageId,
        version,
        body: '',
        contentType: 'error',
        errorMessage: describeReason(err),
      });
    }
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

  private dotnetCommandTimeoutMs(): number {
    const raw = vscode.workspace
      .getConfiguration('nuget-compass')
      .get<number>('dotnetCommandTimeoutMs');
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 120_000;
    return raw;
  }

  loadFontScale(): number {
    const raw = vscode.workspace.getConfiguration('nuget-compass').get<number>('fontScale') ?? 1;
    if (!Number.isFinite(raw)) return 1;
    return Math.min(1.5, Math.max(0.7, raw));
  }

  pushFontScale(): void {
    this.post({ type: 'host:fontScale', fontScale: this.loadFontScale() });
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

  /**
   * Filter dropdowns moved -> persist + recompute newestAllowed for every
   * visible package against the new filter set. Vulnerability and deprecation
   * data is filter-independent, so it's reused from the last enrichment.
   */
  private async applyFilterChange(filters: FilterState): Promise<void> {
    await this.saveFilters(filters);
    if (this.lastProjects.length === 0) return;

    this.post({ type: 'host:status', status: 'fetching' });
    try {
      await Promise.all(
        this.lastProjects.map((project) => this.recomputeNewestAllowed(project, filters)),
      );
    } finally {
      this.post({ type: 'host:status', status: 'idle' });
    }
  }

  private async recomputeNewestAllowed(
    project: Project,
    filters: FilterState,
  ): Promise<void> {
    const existingRows = this.lastRowsByProject.get(project.path) ?? [];
    const topLevel = project.packages.filter((p) => !p.isTransitive);
    if (topLevel.length === 0) return;

    this.post({
      type: 'host:projectStatus',
      projectPath: project.path,
      status: 'enriching',
      progress: { done: 0, total: topLevel.length },
    });

    let done = 0;
    const newestById = new Map<string, string | undefined>();
    await Promise.all(
      topLevel.map(async (pkg) => {
        try {
          const newest = await resolveNewestAllowed({
            packageId: pkg.id,
            currentVersion: pkg.resolvedVersion,
            projectTargetFrameworks: project.targetFrameworks,
            filters,
            catalog: this.catalog,
          });
          newestById.set(pkg.id, newest);
        } catch (err) {
          logger.warn(
            `newestAllowed lookup failed for ${pkg.id}: ${describeReason(err)}`,
          );
          newestById.set(pkg.id, undefined);
        } finally {
          done++;
          if (done === topLevel.length || done % 5 === 0) {
            this.post({
              type: 'host:projectStatus',
              projectPath: project.path,
              status: 'enriching',
              progress: { done, total: topLevel.length },
            });
          }
        }
      }),
    );

    // Keep vuln/deprec data from the prior enrichment; only newestAllowed
    // changes when filters move.
    const prior = new Map(existingRows.map((r) => [r.package.id, r] as const));
    const rows: PackageRow[] = project.packages.map((pkg) => {
      const previous = prior.get(pkg.id);
      const row: PackageRow = { projectPath: project.path, package: pkg };
      if (!pkg.isTransitive) {
        const newest = newestById.get(pkg.id);
        if (newest !== undefined) row.newestAllowed = newest;
        if (previous?.vulnerability) row.vulnerability = previous.vulnerability;
        if (previous?.deprecation) row.deprecation = previous.deprecation;
      }
      return row;
    });

    this.lastRowsByProject.set(project.path, rows);
    this.post({ type: 'host:packageRows', projectPath: project.path, rows });
    this.post({ type: 'host:projectStatus', projectPath: project.path, status: 'ready' });
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
      `img-src ${webview.cspSource} data: https:`,
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

/**
 * NuGet's CLI prints lines like:
 *   error : Response status code does not indicate success: 401 (Unauthorized).
 *   error : Unable to load the service index for source https://nuget.pkg.github.com/...
 * We look for that pair: an auth-failure status and the source URL nearby.
 */
function detectAuthFailureForUrl(sourceUrl: string, outputs: string[]): boolean {
  if (sourceUrl.length === 0) return false;
  const host = safeHost(sourceUrl);
  for (const out of outputs) {
    if (out.length === 0) continue;
    const mentionsSource =
      (host !== undefined && out.includes(host)) || out.includes(sourceUrl);
    if (!mentionsSource) continue;
    if (/\b(401|403)\b/.test(out) || /Unauthorized|Forbidden/i.test(out)) {
      return true;
    }
  }
  return false;
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
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
