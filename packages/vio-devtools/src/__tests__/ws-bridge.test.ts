import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WsBridge } from '../ws-bridge.js'

describe('WsBridge', () => {
  let bridge: WsBridge

  afterEach(async () => {
    await bridge?.close()
  })

  it('reports not connected when no client', () => {
    bridge = new WsBridge({ port: 0 })
    expect(bridge.isConnected()).toBe(false)
  })

  it('sends a request and receives a response', async () => {
    bridge = new WsBridge({ port: 0 })
    const port = await bridge.start()
    const { WebSocket } = await import('ws')
    const client = new WebSocket(`ws://localhost:${port}`)
    await new Promise<void>((resolve) => client.on('open', resolve))
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      client.send(JSON.stringify({ id: msg.id, result: { store: 'data' } }))
    })
    await new Promise((r) => setTimeout(r, 50))
    const result = await bridge.call('getStore', {})
    expect(result).toEqual({ store: 'data' })
    client.close()
  })

  it('rejects with error when client sends error response', async () => {
    bridge = new WsBridge({ port: 0 })
    const port = await bridge.start()
    const { WebSocket } = await import('ws')
    const client = new WebSocket(`ws://localhost:${port}`)
    await new Promise<void>((resolve) => client.on('open', resolve))
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      client.send(JSON.stringify({ id: msg.id, error: { message: 'No store' } }))
    })
    await new Promise((r) => setTimeout(r, 50))
    await expect(bridge.call('getStore', {})).rejects.toThrow('No store')
    client.close()
  })

  it('rejects when no client connected', async () => {
    bridge = new WsBridge({ port: 0 })
    await bridge.start()
    await expect(bridge.call('getStore', {})).rejects.toThrow('No Vio app connected')
  })

  it('replaces old connection with new one', async () => {
    bridge = new WsBridge({ port: 0 })
    const port = await bridge.start()
    const { WebSocket } = await import('ws')
    const client1 = new WebSocket(`ws://localhost:${port}`)
    await new Promise<void>((resolve) => client1.on('open', resolve))
    await new Promise((r) => setTimeout(r, 50))
    expect(bridge.isConnected()).toBe(true)
    const client2 = new WebSocket(`ws://localhost:${port}`)
    await new Promise<void>((resolve) => client2.on('open', resolve))
    await new Promise((r) => setTimeout(r, 50))
    client2.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      client2.send(JSON.stringify({ id: msg.id, result: 'from-client2' }))
    })
    const result = await bridge.call('test', {})
    expect(result).toBe('from-client2')
    client1.close()
    client2.close()
  })
})
