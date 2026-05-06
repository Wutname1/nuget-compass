import * as vscode from 'vscode';
import { PackagesViewProvider } from './webview/packagesViewProvider.js';
import { logger } from './logging/logger.js';

export function activate(context: vscode.ExtensionContext): void {
  logger.init(context);
  logger.info('NuGet Compass activating');

  const provider = new PackagesViewProvider(context);

  // Debounced auto-refresh on project file changes. Multiple file events in
  // quick succession (e.g. a save that triggers restore) coalesce into one
  // refresh.
  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleRefresh = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => provider.refresh(), 750);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{csproj,fsproj,vbproj,props}',
  );
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);

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
    watcher,
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) },
  );

  logger.info('NuGet Compass activated');
}

export function deactivate(): void {
  logger.info('NuGet Compass deactivating');
}
