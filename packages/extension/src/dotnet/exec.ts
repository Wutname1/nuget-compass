import { spawn } from 'node:child_process';
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
export function runDotnet(args: string[], cwd: string, timeoutMs = 30_000): Promise<DotnetResult> {
  const exe = resolveDotnetPath();

  return new Promise((resolve, reject) => {
    logger.trace(`spawn: ${exe} ${args.join(' ')} (cwd=${cwd})`);

    const child = spawn(exe, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new DotnetNotFoundError());
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new DotnetTimeoutError(args, timeoutMs));
        return;
      }
      logger.trace(`exit ${code ?? 'null'}: dotnet ${args.join(' ')}`);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

function resolveDotnetPath(): string {
  const configured = vscode.workspace.getConfiguration('nuget-compass').get<string>('dotnetPath');
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  return 'dotnet';
}
