#!/usr/bin/env node
import { startServer } from './server.js'

startServer().catch((err) => {
  console.error('[vio-devtools] Fatal:', err)
  process.exit(1)
})
