import { spawn, type ChildProcess } from 'node:child_process';
import * as vscode from 'vscode';
import { logger } from '../logging/logger.js';

export interface DotnetResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class DotnetNotFoundError extends Error {
  constructor() {
    super(
      'The .NET SDK was not found. Install it from https://dot.net or set "nuget-compass.dotnetPath".',
    );
    this.name = 'DotnetNotFoundError';
  }
}

export class DotnetTimeoutError extends Error {
  constructor(args: string[], timeoutMs: number) {
    super(`dotnet ${args.join(' ')} timed out after ${timeoutMs}ms`);
    this.name = 'DotnetTimeoutError';
  }
}

/**
 * Run `dotnet <args...>` and capture stdout/stderr.
 *
 * The returned promise rejects on:
 * - failure to spawn (DotnetNotFoundError)
 * - timeout (DotnetTimeoutError)
 *
 * It resolves with a non-zero `code` for any other CLI failure; the caller
 * decides whether the failure is recoverable (e.g. a project with a
 * NuGet error still produces parseable JSON for other projects).
 */
export function runDotnet(
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
  extraEnv?: Record<string, string>,
): Promise<DotnetResult> {
  const exe = resolveDotnetPath();

  return new Promise((resolve, reject) => {
    logger.trace(`spawn: ${exe} ${args.join(' ')} (cwd=${cwd})`);

    const env =
      extraEnv && Object.keys(extraEnv).length > 0
        ? { ...process.env, ...extraEnv }
        : undefined;
    // `detached` puts the child in its own process group so we can kill the
    // whole tree on timeout. `dotnet package list` triggers a restore that
    // spawns MSBuild/NuGet worker processes; a plain child.kill() only signals
    // the top-level `dotnet`, and the surviving workers keep our stdout/stderr
    // pipes open so the 'close' event never fires and this promise hangs
    // forever. stdin is 'ignore' so an interactive credential prompt from a
    // private feed gets EOF and fails fast instead of blocking on input.
    const child = spawn(exe, args, {
      cwd,
      shell: false,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      // A permission/auth block on a private feed can wedge the restore that
      // `dotnet package list` performs. Kill the whole process group and reject
      // now rather than waiting for a 'close' that may never arrive.
      logger.warn(
        `dotnet ${args.join(' ')} timed out after ${timeoutMs}ms; killing process tree.`,
        { category: 'scan' },
      );
      killTree(child);
      settle(() => reject(new DotnetTimeoutError(args, timeoutMs)));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        settle(() => reject(new DotnetNotFoundError()));
        return;
      }
      settle(() => reject(err));
    });

    child.on('close', (code) => {
      logger.trace(`exit ${code ?? 'null'}: dotnet ${args.join(' ')}`);
      settle(() => resolve({ stdout, stderr, code: code ?? -1 }));
    });
  });
}

/**
 * Terminate a spawned `dotnet` and any worker processes it forked. On POSIX the
 * child is a process-group leader (spawned with `detached`), so a negative PID
 * signals the whole group; on Windows we fall back to a direct kill.
 */
function killTree(child: ChildProcess): void {
  try {
    if (process.platform !== 'win32' && typeof child.pid === 'number') {
      process.kill(-child.pid, 'SIGKILL');
      return;
    }
  } catch {
    // Group already gone; fall through to a direct kill.
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already dead.
  }
}

function resolveDotnetPath(): string {
  const configured = vscode.workspace.getConfiguration('nuget-compass').get<string>('dotnetPath');
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  return 'dotnet';
}
