import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { lib: { entry: 'src/main/index.ts' } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { lib: { entry: { index: 'src/preload/index.ts', vdo: 'src/preload/vdo.ts' } } } },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared'), '@video': resolve('src/video') } },
    build: { rollupOptions: { input: 'src/renderer/index.html' } },
  },
})
