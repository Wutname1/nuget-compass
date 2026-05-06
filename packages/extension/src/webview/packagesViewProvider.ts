import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HostMessage, ViewMessage, FilterState } from '@nuget-compass/shared';
import { defaultFilterState } from '@nuget-compass/shared';
import { logger } from '../logging/logger.js';

export class PackagesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'nuget-compass.packages';

  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    this.post({ type: 'host:status', status: 'scanning' });
    // Real scan logic lands in a later commit. For now, this stub just clears state.
    this.post({ type: 'host:projects', projects: [] });
    this.post({ type: 'host:status', status: 'idle' });
  }

  private handleViewMessage(msg: ViewMessage): void {
    logger.trace(`view → host: ${msg.type}`);
    switch (msg.type) {
      case 'view:ready':
        this.post({ type: 'host:init', filters: this.loadFilters() });
        this.refresh();
        return;
      case 'view:refresh':
        this.refresh();
        return;
      case 'view:setFilters':
        void this.saveFilters(msg.filters);
        return;
      case 'view:expandPackage':
        // TODO: fetch available versions for this package
        return;
      case 'view:updatePackage':
        // TODO: run `dotnet add package <id> --version <v>`
        return;
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
