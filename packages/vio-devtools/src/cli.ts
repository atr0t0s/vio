#!/usr/bin/env node
import { startServer, serve } from './server.js'
import { runCli, httpRequest } from './commands.js'

const [command] = process.argv.slice(2)

// `vio see | head` closes stdout early; that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

function fatal(err: unknown): never {
  console.error('[vio-devtools] Fatal:', err)
  process.exit(1)
}

if (!command || command === 'mcp') {
  // No arguments keeps the original behavior: an MCP server on stdio.
  startServer().catch(fatal)
} else if (command === 'serve') {
  serve().catch(fatal)
} else {
  const port = parseInt(process.env.VIO_DEVTOOLS_CONTROL_PORT ?? String(parseInt(process.env.VIO_DEVTOOLS_PORT ?? '3100', 10) + 1), 10)
  runCli(process.argv.slice(2), {
    out: text => process.stdout.write(text + '\n'),
    err: text => process.stderr.write(text + '\n'),
    request: httpRequest(port, process.env.VIO_DEVTOOLS_TOKEN || undefined)
  }).then(code => process.exit(code), fatal)
}
