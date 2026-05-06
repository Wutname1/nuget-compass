import * as vscode from 'vscode';

class Logger {
  private channel: vscode.OutputChannel | undefined;

  init(_context: vscode.ExtensionContext): void {
    this.channel = vscode.window.createOutputChannel('Compass: NuGet');
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `\n${err.stack ?? err.message}` : '';
    this.write('ERROR', message + detail);
  }

  trace(message: string): void {
    const cfg = vscode.workspace.getConfiguration('nuget-compass');
    if (cfg.get<boolean>('trace')) {
      this.write('TRACE', message);
    }
  }

  show(): void {
    this.channel?.show(true);
  }

  private write(level: string, message: string): void {
    const ts = new Date().toISOString();
    this.channel?.appendLine(`[${ts}] [${level}] ${message}`);
  }
}

export const logger = new Logger();
