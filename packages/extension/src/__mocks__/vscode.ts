/**
 * Minimal stub of the `vscode` module for unit tests run by Vitest.
 *
 * We deliberately don't replicate the full API surface — only what the
 * extension code touches at module-load time. Any test that needs richer
 * VS Code behavior should mock at the function level via vi.spyOn rather
 * than expanding this stub.
 */

class OutputChannel {
  appendLine(_message: string): void {
    // no-op
  }
  show(_preserveFocus?: boolean): void {
    // no-op
  }
}

export const window = {
  createOutputChannel(_name: string): OutputChannel {
    return new OutputChannel();
  },
};

export const workspace = {
  getConfiguration(_section?: string) {
    return {
      get<T>(_key: string): T | undefined {
        return undefined;
      },
      update(): Promise<void> {
        return Promise.resolve();
      },
    };
  },
  findFiles(): Promise<unknown[]> {
    return Promise.resolve([]);
  },
  workspaceFolders: undefined as unknown[] | undefined,
};

export const commands = {
  registerCommand(): { dispose(): void } {
    return { dispose() {} };
  },
  executeCommand(): Promise<void> {
    return Promise.resolve();
  },
};

export const Uri = {
  joinPath(...parts: string[]): { fsPath: string; toString(): string } {
    const fsPath = parts.join('/');
    return { fsPath, toString: () => fsPath };
  },
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
