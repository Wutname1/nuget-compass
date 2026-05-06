import type { ViewMessage } from '@nuget-compass/shared';

interface VsCodeApi {
  postMessage(message: ViewMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

// `acquireVsCodeApi` may only be called once per webview lifetime.
// We cache the handle here.
let cached: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (cached) return cached;
  if (typeof acquireVsCodeApi === 'function') {
    cached = acquireVsCodeApi();
    return cached;
  }
  // Stub for local dev / tests where the host isn't present.
  cached = {
    postMessage: (msg) => console.debug('[stub vscode.postMessage]', msg),
    getState: () => undefined,
    setState: () => undefined,
  };
  return cached;
}

export const vscode = {
  postMessage(message: ViewMessage): void {
    getApi().postMessage(message);
  },
};
