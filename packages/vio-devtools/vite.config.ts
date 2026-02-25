import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/client.ts'),
      formats: ['es'],
      fileName: 'client'
    },
    outDir: 'dist',
    emptyOutDir: false
  },
  test: {
    environment: 'node',
    globals: true
  }
})
