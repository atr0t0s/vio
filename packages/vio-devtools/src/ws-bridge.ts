import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { createRequest, isResponse, isErrorResponse } from './protocol.js'
import type { WsResponse, WsErrorResponse } from './protocol.js'

export interface WsBridgeOptions {
  port: number
  timeout?: number
  /** Interface to bind. Defaults to loopback so the bridge is never reachable from the network. */
  host?: string
  /** When set, clients must connect with `?token=<token>`. */
  token?: string
  /** Extra browser origins allowed besides localhost/127.0.0.1/[::1]. */
  allowedOrigins?: string[]
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const MAX_PAYLOAD = 1024 * 1024

/**
 * Browsers always send Origin; any web page could otherwise drive the app via
 * ws://localhost. Non-browser clients (no Origin) are local processes.
 */
export function isAllowedOrigin(origin: string | undefined, extra: string[] = []): boolean {
  if (!origin) return true
  if (extra.includes(origin)) return true
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

function tokenMatches(expected: string, url: string | undefined): boolean {
  const given = new URL(url ?? '/', 'http://localhost').searchParams.get('token') ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WsBridge {
  private wss: WebSocketServer | null = null
  private client: WebSocket | null = null
  /** What the connected page reported about itself ({url, title}) and when it connected. */
  private clientInfo: { url?: string; title?: string; since: string } | null = null
  private pending = new Map<number, PendingCall>()
  private port: number
  private timeout: number
  private options: WsBridgeOptions

  constructor(options: WsBridgeOptions) {
    this.port = options.port
    this.timeout = options.timeout ?? 5000
    this.options = options
  }

  private verifyClient = (info: { origin: string; req: IncomingMessage }): boolean => {
    if (!isAllowedOrigin(info.origin || undefined, this.options.allowedOrigins)) return false
    if (this.options.token && !tokenMatches(this.options.token, info.req.url)) return false
    return true
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.port,
        host: this.options.host ?? '127.0.0.1',
        maxPayload: MAX_PAYLOAD,
        verifyClient: this.verifyClient
      })
      this.wss.on('listening', () => {
        const addr = this.wss!.address()
        const port = typeof addr === 'object' && addr !== null ? addr.port : this.port
        resolve(port)
      })
      this.wss.on('error', reject)
      this.wss.on('connection', (ws, req) => {
        // A replaced page retries in standby mode: it may only fill an empty slot.
        const standby = new URL(req.url ?? '/', 'http://localhost').searchParams.has('standby')
        if (standby && this.isConnected()) {
          ws.close(4001, 'another page is active')
          return
        }
        if (this.client && this.client.readyState === WebSocket.OPEN) {
          // Newest page wins; say so, since the CLI/MCP now drives a different tab.
          console.error(`[vio-devtools] a new page connected; dropping ${this.clientInfo?.url ?? 'the previous one'}`)
          this.client.close(4001, 'replaced by a newer page')
        }
        this.client = ws
        this.clientInfo = { since: new Date().toISOString() }
        ws.on('message', (data) => {
          let msg: (WsResponse | WsErrorResponse) & { hello?: { url?: unknown; title?: unknown } }
          try {
            msg = JSON.parse(data.toString())
          } catch {
            return
          }
          if (msg?.hello && this.client === ws && this.clientInfo) {
            const { url, title } = msg.hello
            if (typeof url === 'string') this.clientInfo.url = url.slice(0, 300)
            if (typeof title === 'string') this.clientInfo.title = title.slice(0, 120)
            console.error(`[vio-devtools] connected: ${this.clientInfo.url ?? 'unknown page'}`)
            return
          }
          if (!msg || typeof msg.id !== 'number') return
          const pending = this.pending.get(msg.id)
          if (!pending) return
          clearTimeout(pending.timer)
          this.pending.delete(msg.id)
          if (isErrorResponse(msg)) {
            pending.reject(new Error(msg.error.message))
          } else if (isResponse(msg)) {
            pending.resolve(msg.result)
          }
        })
        ws.on('close', () => {
          if (this.client === ws) {
            this.client = null
            this.clientInfo = null
          }
        })
      })
    })
  }

  /** One line describing which page the bridge is driving. */
  status(): string {
    if (!this.isConnected() || !this.clientInfo) return 'no app connected; open the app (it must call connectDevtools)'
    const { url, title, since } = this.clientInfo
    return `connected: ${url ?? 'unknown page'}${title ? ` "${title}"` : ''} since ${since}`
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('No Vio app connected. Start your app and call connectDevtools(app).'))
        return
      }
      const req = createRequest(method, params)
      const timer = setTimeout(() => {
        this.pending.delete(req.id)
        reject(new Error(`Timeout: ${method} did not respond within ${this.timeout}ms`))
      }, this.timeout)
      this.pending.set(req.id, { resolve, reject, timer })
      this.client!.send(JSON.stringify(req))
    })
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Bridge closed'))
    }
    this.pending.clear()
    if (this.client) { this.client.close(); this.client = null }
    return new Promise((resolve) => {
      if (this.wss) { this.wss.close(() => resolve()) } else { resolve() }
    })
  }
}
