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
    // The hello handshake is covered separately; keep `sent` to request replies.
    if (JSON.parse(data).hello) this.hellos.push(data)
    else this.sent.push(data)
  }

  hellos: string[] = []

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

describe('connectDevtools hardening', () => {
  it('passes the token and ignores malformed or prototype method names', () => {
    const app = { getStore: vi.fn() } as any
    const conn = connectDevtools(app, { token: 'a b' })
    const ws = conn.ws as unknown as MockWebSocket
    expect(ws.url).toBe('ws://127.0.0.1:3100?token=a%20b')
    ws.onmessage?.({ data: 'garbage' })
    ws.onmessage?.({ data: JSON.stringify({ id: 9, method: 'constructor', params: {} }) })
    expect(JSON.parse(ws.sent[0]!)).toEqual({ id: 9, error: { message: 'Unknown method: constructor' } })
  })
})

describe('agent contract methods', () => {
  function connect(app: Record<string, unknown>) {
    const ws = connectDevtools(app as any).ws as unknown as MockWebSocket
    const call = async (id: number, method: string, params: Record<string, unknown> = {}) => {
      ws.onmessage?.({ data: JSON.stringify({ id, method, params }) })
      await new Promise(r => setTimeout(r, 5))
      return JSON.parse(ws.sent.find(s => JSON.parse(s).id === id)!)
    }
    return call
  }

  it('awaits async results like act', async () => {
    const call = connect({ act: vi.fn().mockResolvedValue('~ button#e5 "Saved"') })
    expect(await call(1, 'act', { ref: 'e5', action: 'click' })).toEqual({ id: 1, result: '~ button#e5 "Saved"' })
  })

  it('returns async errors as error responses', async () => {
    const call = connect({ invoke: vi.fn().mockRejectedValue(new Error('E_CONFIRM: needs confirmation')) })
    expect(await call(2, 'invoke', { action: 'clear' })).toEqual({ id: 2, error: { message: 'E_CONFIRM: needs confirmation' } })
  })

  it('reads state by pointer and refuses store writes', async () => {
    const call = connect({ getStore: () => ({ todos: [{ text: 'a/b' }] }), getState: () => ({ n: 1 }), setState: vi.fn() })
    expect((await call(3, 'state', { path: '/todos/0/text' })).result).toBe('a/b')
    expect((await call(4, 'state', { id: 'X', path: '/n' })).result).toBe(1)
    expect((await call(5, 'state', { set: { n: 2 } })).error.message).toMatch(/E_STATE/)
  })

  it('patches component state and returns a diff', async () => {
    const patchState = vi.fn()
    const call = connect({ patchState, see: () => '+ e9 h1 "Hello"' })
    const ops = [{ op: 'replace', path: '/spec/root', value: 'h' }]
    expect((await call(8, 'state', { id: 'View', patch: ops })).result).toBe('+ e9 h1 "Hello"')
    expect(patchState).toHaveBeenCalledWith('View', ops)
  })

  it('debug filters errors and formats compactly', async () => {
    const getEventHistory = () => [
      { type: 'state:change', payload: {}, timestamp: 0, seq: 1 },
      { type: 'component:error', payload: { id: 'App/X', message: 'boom' }, timestamp: 0, seq: 2 }
    ]
    const call = connect({ getEventHistory })
    expect((await call(6, 'debug', { what: 'errors' })).result).toBe('2 component:error {"id":"App/X","message":"boom"}')
  })

  it('nav reports unknown routes', async () => {
    const call = connect({ navigate: () => false, see: () => '' })
    expect((await call(7, 'nav', { path: '/nope' })).error.message).toMatch(/E_NOT_FOUND/)
  })
})

describe('hello handshake', () => {
  it('tells the bridge which page connected', async () => {
    // These tests run in Node; stand in for the page globals.
    const g = globalThis as Record<string, unknown>
    g.location = { href: 'http://localhost:4005/#/' }
    g.document = { title: 'My App' }
    try {
      const ws = connectDevtools({} as any).ws as unknown as MockWebSocket
      await new Promise(r => setTimeout(r, 5))
      expect(JSON.parse(ws.hellos[0]!)).toEqual({ hello: { url: 'http://localhost:4005/#/', title: 'My App' } })
    } finally {
      delete g.location
      delete g.document
    }
  })
})

describe('reconnect', () => {
  it('reconnects after the server goes away, stands by when replaced, stops when disconnected', async () => {
    vi.useFakeTimers()
    try {
      const created: MockWebSocket[] = []
      const Orig = (globalThis as any).WebSocket
      ;(globalThis as any).WebSocket = class extends Orig { constructor(url: string) { super(url); created.push(this as any) } }
      const conn = connectDevtools({} as any)
      created[0]!.onclose?.({ code: 1006 } as any)
      await vi.advanceTimersByTimeAsync(1010) // reconnect, then its open event
      expect(created).toHaveLength(2)
      // Replaced by another page: retry slowly in standby mode only.
      ;(created[1] as any).onclose?.({ code: 4001 })
      await vi.advanceTimersByTimeAsync(9000)
      expect(created).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1000)
      expect(created).toHaveLength(3)
      expect(created[2]!.url).toBe('ws://127.0.0.1:3100?standby=1')
      conn.disconnect()
      ;(created[2] as any).onclose?.({ code: 1006 })
      await vi.advanceTimersByTimeAsync(20000)
      expect(created).toHaveLength(3)
      ;(globalThis as any).WebSocket = Orig
    } finally {
      vi.useRealTimers()
    }
  })
})
