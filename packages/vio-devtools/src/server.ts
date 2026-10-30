import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WsBridge } from './ws-bridge.js'
import { TOOLS } from './tools.js'
import { startControl } from './control.js'

const DEFAULT_PORT = 3100

export function registerTools(server: McpServer, bridge: WsBridge): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (params: Record<string, unknown>) => {
        try {
          const result = await bridge.call(tool.wsMethod, params)
          // Snapshots are already compact text; everything else as one-line JSON.
          const text = typeof result === 'string' ? result : JSON.stringify(result) ?? 'null'
          return {
            content: [{ type: 'text' as const, text }]
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true
          }
        }
      }
    )
  }
}

export interface Ports {
  ws: number
  control: number
}

function readEnv() {
  const port = parseInt(process.env.VIO_DEVTOOLS_PORT ?? String(DEFAULT_PORT), 10)
  return {
    port,
    controlPort: parseInt(process.env.VIO_DEVTOOLS_CONTROL_PORT ?? String(port + 1), 10),
    token: process.env.VIO_DEVTOOLS_TOKEN || undefined,
    allowedOrigins: (process.env.VIO_DEVTOOLS_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean)
  }
}

/** Start the browser bridge plus the local control endpoint the CLI uses. */
export async function startBridge(): Promise<{ bridge: WsBridge; ports: Ports }> {
  const env = readEnv()
  const bridge = new WsBridge({ port: env.port, token: env.token, allowedOrigins: env.allowedOrigins })
  const ws = await bridge.start()
  console.error(`[vio-devtools] WebSocket server listening on 127.0.0.1:${ws}${env.token ? ' (token required)' : ''}`)
  let control = -1
  try {
    control = (await startControl(bridge, { port: env.controlPort, token: env.token })).port
    console.error(`[vio-devtools] CLI control on 127.0.0.1:${control}`)
  } catch (err) {
    // Another devtools process already serves the CLI; the bridge still works for MCP.
    console.error(`[vio-devtools] CLI control port ${env.controlPort} unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { bridge, ports: { ws, control } }
}

export async function startServer(): Promise<void> {
  const { bridge } = await startBridge()

  const server = new McpServer({
    name: 'vio-devtools',
    version: '0.1.0'
  })

  registerTools(server, bridge)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[vio-devtools] MCP server connected via stdio')
}

/** Bridge + control only, for agents that use the CLI instead of MCP. Runs until killed. */
export async function serve(): Promise<void> {
  await startBridge()
  console.error('[vio-devtools] serving; open the app, then use `vio see`, `vio act`, …')
}
