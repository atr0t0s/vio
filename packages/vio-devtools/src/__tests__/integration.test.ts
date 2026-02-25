import { describe, it, expect, afterEach } from 'vitest'
import { WsBridge } from '../ws-bridge.js'
import { WebSocket } from 'ws'

describe('integration: MCP server ↔ WS bridge ↔ mock browser', () => {
  let bridge: WsBridge
  let client: WebSocket

  afterEach(async () => {
    client?.close()
    await bridge?.close()
  })

  it('full round-trip: bridge.call → browser → response', async () => {
    bridge = new WsBridge({ port: 0 })
    const port = await bridge.start()

    client = new WebSocket(`ws://localhost:${port}`)
    await new Promise<void>((resolve) => client.on('open', resolve))

    const mockApp: Record<string, unknown> = {
      todos: [{ id: 1, text: 'Test', completed: false }],
      filter: 'all'
    }

    client.on('message', (data) => {
      const req = JSON.parse(data.toString())
      switch (req.method) {
        case 'getStore':
          client.send(JSON.stringify({ id: req.id, result: mockApp }))
          break
        case 'dispatch':
          client.send(JSON.stringify({ id: req.id, result: { success: true } }))
          break
        case 'getComponentTree':
          client.send(JSON.stringify({
            id: req.id,
            result: { id: 'App-1', name: 'App', state: {}, children: [] }
          }))
          break
        default:
          client.send(JSON.stringify({ id: req.id, result: { success: true } }))
      }
    })

    await new Promise((r) => setTimeout(r, 50))

    const store = await bridge.call('getStore', {})
    expect(store).toEqual(mockApp)

    const tree = await bridge.call('getComponentTree', {})
    expect(tree).toEqual({ id: 'App-1', name: 'App', state: {}, children: [] })

    const dispatchResult = await bridge.call('dispatch', { action: 'addTodo', payload: 'New' })
    expect(dispatchResult).toEqual({ success: true })
  })
})
