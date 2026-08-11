import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  base: '/webui/',
  server: {
    fs: {
      allow: ['../..'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5510',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:5510',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
