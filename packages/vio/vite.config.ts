import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Vio',
      formats: ['es', 'cjs'],
      fileName: 'vio'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
})
