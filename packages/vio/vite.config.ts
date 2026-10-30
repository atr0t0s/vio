import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: {
        vio: resolve(__dirname, 'src/index.ts'),
        spec: resolve(__dirname, 'src/spec/index.ts')
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'js' : 'cjs'}`
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
})
