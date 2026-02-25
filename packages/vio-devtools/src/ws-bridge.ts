import { WebSocketServer, WebSocket } from 'ws'
import { createRequest, isResponse, isErrorResponse } from './protocol.js'
import type { WsResponse, WsErrorResponse } from './protocol.js'

export interface WsBridgeOptions {
  port: number
  timeout?: number
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WsBridge {
  private wss: WebSocketServer | null = null
  private client: WebSocket | null = null
  private pending = new Map<number, PendingCall>()
  private port: number
  private timeout: number

  constructor(options: WsBridgeOptions) {
    this.port = options.port
    this.timeout = options.timeout ?? 5000
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port })
      this.wss.on('listening', () => {
        const addr = this.wss!.address()
        const port = typeof addr === 'object' && addr !== null ? addr.port : this.port
        resolve(port)
      })
      this.wss.on('error', reject)
      this.wss.on('connection', (ws) => {
        if (this.client && this.client.readyState === WebSocket.OPEN) {
          this.client.close()
        }
        this.client = ws
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as WsResponse | WsErrorResponse
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
          if (this.client === ws) this.client = null
        })
      })
    })
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
