import * as vscode from 'vscode';
import * as path from 'node:path';
import { PackagesViewProvider } from './webview/packagesViewProvider.js';
import { logger } from './logging/logger.js';

export function activate(context: vscode.ExtensionContext): void {
  logger.init(context);
  logger.info('NuGet Compass activating');

  const provider = new PackagesViewProvider(context);

  // Debounced auto-refresh when project-shaping files change on disk. Multiple
  // events in quick succession (a save that triggers restore; a tool rewriting
  // the .csproj; user editing several projects at once) coalesce into a single
  // refresh. We log every triggering URI so the Activity tab tells the user
  // *why* a scan just happened.
  let refreshTimer: NodeJS.Timeout | undefined;
  const pendingTriggers = new Set<string>();
  const flushTriggers = (kind: 'changed' | 'created' | 'deleted', uri: vscode.Uri): void => {
    const display = path.basename(uri.fsPath);
    pendingTriggers.add(`${kind} ${display}`);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const triggers = Array.from(pendingTriggers);
      pendingTriggers.clear();
      // Skip the "External change detected" entry while we're mid-bulk-update:
      // every dotnet add we run writes the .csproj and that would otherwise
      // log a fake external-change for every iteration. The bulk run schedules
      // its own refresh when it finishes, so dropping the log + skipping the
      // refresh here is safe.
      if (provider.isBulkRunActive()) return;
      logger.info(
        `External change detected (${triggers.length} file${triggers.length === 1 ? '' : 's'}): ${triggers.slice(0, 5).join(', ')}${triggers.length > 5 ? `, …and ${triggers.length - 5} more` : ''}. Re-scanning.`,
        { category: 'scan' },
      );
      provider.refresh();
    }, 750);
  };

  // Project files, MSBuild props, and NuGet config all influence the package
  // set or how it gets resolved. Watch them all.
  const projectWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{csproj,fsproj,vbproj}',
  );
  projectWatcher.onDidChange((uri) => flushTriggers('changed', uri));
  projectWatcher.onDidCreate((uri) => flushTriggers('created', uri));
  projectWatcher.onDidDelete((uri) => flushTriggers('deleted', uri));

  const propsWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{Directory.Build.props,Directory.Packages.props,*.props,*.targets}',
  );
  propsWatcher.onDidChange((uri) => flushTriggers('changed', uri));
  propsWatcher.onDidCreate((uri) => flushTriggers('created', uri));
  propsWatcher.onDidDelete((uri) => flushTriggers('deleted', uri));

  const nugetWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{nuget.config,NuGet.config,NuGet.Config,packages.config,packages.lock.json}',
  );
  nugetWatcher.onDidChange((uri) => flushTriggers('changed', uri));
  nugetWatcher.onDidCreate((uri) => flushTriggers('created', uri));
  nugetWatcher.onDidDelete((uri) => flushTriggers('deleted', uri));

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('nuget-compass.fontScale')) {
      provider.pushFontScale();
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PackagesViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    configListener,
    vscode.commands.registerCommand('nuget-compass.open', () => {
      void vscode.commands.executeCommand('nuget-compass.packages.focus');
    }),
    vscode.commands.registerCommand('nuget-compass.refresh', () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand('nuget-compass.forceRefresh', () => {
      void provider.forceRefresh();
    }),
    projectWatcher,
    propsWatcher,
    nugetWatcher,
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) },
  );

  logger.info('NuGet Compass activated');
}

export function deactivate(): void {
  logger.info('NuGet Compass deactivating');
}
