import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        inline: [/@nuget-compass\/.*/],
      },
    },
  },
  resolve: {
    alias: {
      // The extension imports `vscode` for runtime APIs and the OutputChannel.
      // Tests should never exercise that code path; redirect to a tiny stub.
      vscode: resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
  },
});
