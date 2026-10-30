import { describe, it, expect } from 'vitest'
import { TOOLS } from '../tools.js'

describe('tool definitions', () => {
  it('defines the 8 agent-contract tools', () => {
    expect(TOOLS.map(t => t.name)).toEqual([
      'vio_manifest', 'vio_see', 'vio_act', 'vio_invoke', 'vio_assert', 'vio_state', 'vio_nav', 'vio_debug'
    ])
  })

  it('each tool has name, description, and wsMethod', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.wsMethod).toBeTruthy()
    }
  })

  it('vio_act requires ref and action', () => {
    const act = TOOLS.find((t) => t.name === 'vio_act')!
    expect(act.inputSchema.ref!.isOptional()).toBe(false)
    expect(act.inputSchema.action!.isOptional()).toBe(false)
    expect(act.inputSchema.value!.isOptional()).toBe(true)
  })

  it('vio_manifest has no params', () => {
    const manifest = TOOLS.find((t) => t.name === 'vio_manifest')!
    expect(Object.keys(manifest.inputSchema)).toHaveLength(0)
  })
})

describe('token budget', () => {
  // Measures the exact tools/list payload an MCP client receives and resends every turn.
  // Baseline: the previous 11 low-level tools measured 911 tokens this way.
  it('all tool definitions together stay under 800 tokens', async () => {
    const { encode } = await import('gpt-tokenizer')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const { registerTools } = await import('../server.js')

    const server = new McpServer({ name: 't', version: '0' })
    registerTools(server, {} as never)
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'c', version: '0' })
    await Promise.all([server.connect(a), client.connect(b)])
    const { tools } = await client.listTools()
    await client.close()

    expect(tools).toHaveLength(8)
    expect(encode(JSON.stringify(tools)).length).toBeLessThanOrEqual(800)
  })
})
