import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  root: 'webview',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./webview', import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
      },
    },
  },
});
