import * as vscode from 'vscode';
import type { ActivityCategory, ActivityEntry, ActivityLevel } from '@nuget-compass/shared';

const RING_BUFFER_CAP = 500;

export interface ActivityOptions {
  category?: ActivityCategory;
  detail?: string;
  context?: ActivityEntry['context'];
}

type Subscriber = (entry: ActivityEntry) => void;

class Logger {
  private channel: vscode.OutputChannel | undefined;
  private readonly buffer: ActivityEntry[] = [];
  private nextId = 1;
  private subscriber: Subscriber | undefined;

  init(_context: vscode.ExtensionContext): void {
    this.channel = vscode.window.createOutputChannel('Compass: NuGet');
  }

  info(message: string, options?: ActivityOptions): void {
    this.record('info', message, options);
  }

  warn(message: string, options?: ActivityOptions): void {
    this.record('warn', message, options);
  }

  error(message: string, errOrOptions?: unknown, options?: ActivityOptions): void {
    let opts: ActivityOptions | undefined = options;
    let detail = opts?.detail;
    if (errOrOptions !== undefined) {
      if (
        typeof errOrOptions === 'object' &&
        errOrOptions !== null &&
        !(errOrOptions instanceof Error) &&
        ('category' in errOrOptions || 'detail' in errOrOptions || 'context' in errOrOptions)
      ) {
        opts = errOrOptions as ActivityOptions;
        detail = opts.detail;
      } else if (errOrOptions instanceof Error) {
        detail = errOrOptions.stack ?? errOrOptions.message;
      } else if (typeof errOrOptions === 'string') {
        detail = errOrOptions;
      } else {
        try {
          detail = JSON.stringify(errOrOptions);
        } catch {
          detail = Object.prototype.toString.call(errOrOptions);
        }
      }
    }
    this.record('error', message, { ...(opts ?? {}), detail });
  }

  trace(message: string, options?: ActivityOptions): void {
    const cfg = vscode.workspace.getConfiguration('nuget-compass');
    if (cfg.get<boolean>('trace')) {
      this.record('debug', message, options);
    }
  }

  /** Subscribe to live activity entries (also flushes the current buffer). */
  subscribe(fn: Subscriber): { entries: ActivityEntry[]; unsubscribe: () => void } {
    this.subscriber = fn;
    return {
      entries: [...this.buffer],
      unsubscribe: () => {
        if (this.subscriber === fn) this.subscriber = undefined;
      },
    };
  }

  snapshot(): ActivityEntry[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }

  show(): void {
    this.channel?.show(true);
  }

  private record(level: ActivityLevel, message: string, options?: ActivityOptions): void {
    const entry: ActivityEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      category: options?.category ?? 'general',
      message,
      detail: options?.detail,
      context: options?.context,
    };
    this.buffer.push(entry);
    if (this.buffer.length > RING_BUFFER_CAP) {
      this.buffer.splice(0, this.buffer.length - RING_BUFFER_CAP);
    }
    this.writeChannel(entry);
    this.subscriber?.(entry);
  }

  private writeChannel(entry: ActivityEntry): void {
    const ts = new Date(entry.timestamp).toISOString();
    const levelLabel = entry.level === 'debug' ? 'TRACE' : entry.level.toUpperCase();
    const ctx = entry.context;
    const ctxParts: string[] = [];
    if (ctx?.projectName) ctxParts.push(ctx.projectName);
    else if (ctx?.projectPath) ctxParts.push(ctx.projectPath);
    if (ctx?.packageId) {
      ctxParts.push(ctx.version ? `${ctx.packageId}@${ctx.version}` : ctx.packageId);
    }
    const ctxLabel = ctxParts.length > 0 ? ` [${ctxParts.join(' / ')}]` : '';
    const body = entry.detail ? `${entry.message}\n${entry.detail}` : entry.message;
    this.channel?.appendLine(`[${ts}] [${levelLabel}]${ctxLabel} ${body}`);
  }
}

export const logger = new Logger();
