import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The webview is loaded by VS Code from the extension's `dist/webview/` directory.
// We emit there directly so the extension bundle doesn't have to copy assets.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../extension/dist/webview'),
    emptyOutDir: true,
    sourcemap: true,
    // VS Code webviews can load relative URIs once asWebviewUri-rewritten by the host.
    // Inline assets aggressively to keep the file count down.
    assetsInlineLimit: 16 * 1024,
    rollupOptions: {
      output: {
        // Predictable filenames help the host's HTML rewriter.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
