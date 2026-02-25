import { describe, it, expect, vi } from 'vitest'

vi.mock('../ws-bridge.js', () => {
  return {
    WsBridge: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(3100),
      call: vi.fn().mockResolvedValue({ some: 'data' }),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true)
    }))
  }
})

import { registerTools } from '../server.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WsBridge } from '../ws-bridge.js'

describe('server', () => {
  it('registers all 11 tools', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    const bridge = new WsBridge({ port: 0 })

    const spy = vi.spyOn(server, 'registerTool')
    registerTools(server, bridge)

    expect(spy.mock.calls.length).toBe(11)
  })
})
