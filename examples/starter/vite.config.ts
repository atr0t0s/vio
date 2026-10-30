import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: { port: 4005 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        spec: resolve(__dirname, 'spec.html')
      }
    }
  }
})
