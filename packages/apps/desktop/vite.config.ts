import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  clearScreen: false,
  server: {
    port: 1520,
    strictPort: true,
    fs: { allow: ['../..'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome100',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
