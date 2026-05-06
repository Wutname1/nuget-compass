import * as vscode from 'vscode';
import { PackagesViewProvider } from './webview/packagesViewProvider.js';
import { logger } from './logging/logger.js';

export function activate(context: vscode.ExtensionContext): void {
  logger.init(context);
  logger.info('NuGet Compass activating');

  const provider = new PackagesViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PackagesViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('nuget-compass.open', () => {
      void vscode.commands.executeCommand('nuget-compass.packages.focus');
    }),
    vscode.commands.registerCommand('nuget-compass.refresh', () => {
      provider.refresh();
    }),
  );

  logger.info('NuGet Compass activated');
}

export function deactivate(): void {
  logger.info('NuGet Compass deactivating');
}
