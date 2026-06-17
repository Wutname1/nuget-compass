import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { runDotnet, DotnetTimeoutError } from './exec.js';

/**
 * Point runDotnet at a real interpreter so we can drive process-tree shapes
 * without needing the .NET SDK installed.
 */
function useExecutable(path: string): void {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string) => (key === 'dotnetPath' ? path : undefined),
    update: () => Promise.resolve(),
  } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
}

describe('runDotnet timeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // POSIX-only: the regression depends on process-group kill semantics.
  const maybe = process.platform === 'win32' ? it.skip : it;

  maybe(
    'rejects promptly when the child backgrounds a process holding the stdout pipe',
    async () => {
      useExecutable('/bin/sh');

      // The backgrounded `sleep` inherits stdout, so the pipe stays open after
      // the top-level shell is signalled. Before the fix, the promise only
      // settled on the 'close' event — which never fired here — so this hung
      // forever. Now the timer rejects and kills the whole process group.
      const started = Date.now();
      await expect(
        runDotnet(['-c', 'sleep 30 & sleep 30'], process.cwd(), 300),
      ).rejects.toBeInstanceOf(DotnetTimeoutError);

      // Should reject right at the timeout, not wait on the 30s sleeps.
      expect(Date.now() - started).toBeLessThan(3000);
    },
  );

  maybe('resolves normally for a fast command', async () => {
    useExecutable('/bin/sh');
    const result = await runDotnet(['-c', 'printf hi'], process.cwd(), 5000);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hi');
  });
});
