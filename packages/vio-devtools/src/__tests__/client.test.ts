import { describe, it, expect, vi, beforeEach } from 'vitest'

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    setTimeout(() => this.onopen?.(), 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

;(globalThis as any).WebSocket = MockWebSocket

import { connectDevtools } from '../client.js'

describe('connectDevtools', () => {
  let mockApp: Record<string, any>

  beforeEach(() => {
    mockApp = {
      getState: vi.fn().mockReturnValue({ count: 0 }),
      setState: vi.fn(),
      getStore: vi.fn().mockReturnValue({ todos: [] }),
      dispatch: vi.fn(),
      navigate: vi.fn(),
      getComponentTree: vi.fn().mockReturnValue({ id: 'App-1', name: 'App', state: {}, children: [] }),
      getRegisteredComponents: vi.fn().mockReturnValue(['App', 'Header']),
      removeComponent: vi.fn(),
      batch: vi.fn(),
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      getEventHistory: vi.fn().mockReturnValue([])
    }
  })

  it('connects to the default port', () => {
    const conn = connectDevtools(mockApp as any)
    expect(conn).toBeDefined()
  })

  it('calls the correct app method when receiving a getStore request', async () => {
    const conn = connectDevtools(mockApp as any)
    await new Promise((r) => setTimeout(r, 10))
    const ws = (conn as any).ws as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ id: 1, method: 'getStore', params: {} }) })
    expect(mockApp.getStore).toHaveBeenCalled()
    expect(ws.sent).toHaveLength(1)
    const response = JSON.parse(ws.sent[0]!)
    expect(response.id).toBe(1)
    expect(response.result).toEqual({ todos: [] })
  })

  it('calls dispatch with correct params', async () => {
    const conn = connectDevtools(mockApp as any)
    await new Promise((r) => setTimeout(r, 10))
    const ws = (conn as any).ws as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ id: 2, method: 'dispatch', params: { action: 'addTodo', payload: 'test' } }) })
    expect(mockApp.dispatch).toHaveBeenCalledWith('addTodo', 'test')
  })

  it('sends error response when method throws', async () => {
    mockApp.dispatch = vi.fn().mockImplementation(() => { throw new Error('No store') })
    const conn = connectDevtools(mockApp as any)
    await new Promise((r) => setTimeout(r, 10))
    const ws = (conn as any).ws as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ id: 3, method: 'dispatch', params: { action: 'bad' } }) })
    expect(ws.sent).toHaveLength(1)
    const response = JSON.parse(ws.sent[0]!)
    expect(response.id).toBe(3)
    expect(response.error.message).toBe('No store')
  })

  it('disconnect closes the WebSocket', async () => {
    const conn = connectDevtools(mockApp as any)
    await new Promise((r) => setTimeout(r, 10))
    conn.disconnect()
    const ws = (conn as any).ws as MockWebSocket
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })
})
