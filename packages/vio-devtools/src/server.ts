import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WsBridge } from './ws-bridge.js'
import { TOOLS } from './tools.js'

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
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
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

export async function startServer(): Promise<void> {
  const port = parseInt(process.env.VIO_DEVTOOLS_PORT ?? String(DEFAULT_PORT), 10)

  const bridge = new WsBridge({ port })
  const actualPort = await bridge.start()
  console.error(`[vio-devtools] WebSocket server listening on port ${actualPort}`)

  const server = new McpServer({
    name: 'vio-devtools',
    version: '0.1.0'
  })

  registerTools(server, bridge)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[vio-devtools] MCP server connected via stdio')
}
