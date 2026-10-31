import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

// Local HTTP control endpoint: lets the `vio` CLI (a separate, short-lived
// process) reach the browser through whichever process owns the WS bridge.
// POST /call {method, params} → {result} | {error}.

export interface Caller {
  call(method: string, params: Record<string, unknown>): Promise<unknown>
  /** Answered locally, without the browser (works when nothing is connected). */
  status?(): string
}

export interface ControlOptions {
  port: number
  host?: string
  token?: string
}

const MAX_BODY = 1024 * 1024
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sameToken(expected: string, given: string | undefined): boolean {
  const a = Buffer.from(given ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Refuses anything a web page could send: browsers always attach Origin to
 * cross-site POSTs, and a non-loopback Host means DNS rebinding.
 */
export function rejectReason(req: IncomingMessage, token?: string): string | null {
  if (req.headers.origin) return 'browser requests are not allowed'
  if (!LOOPBACK.test(req.headers.host ?? '')) return 'host must be loopback'
  if (token && !sameToken(token, req.headers['x-vio-token'] as string | undefined)) return 'bad or missing x-vio-token'
  return null
}

export function startControl(caller: Caller, options: ControlOptions): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const reason = rejectReason(req, options.token)
    if (reason) return send(res, 403, { error: { message: `E_FORBIDDEN: ${reason}` } })
    if (req.method !== 'POST' || req.url !== '/call') return send(res, 404, { error: { message: 'POST /call only' } })

    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        send(res, 413, { error: { message: 'body too large' } })
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', async () => {
      if (res.headersSent) return
      let body: { method?: unknown; params?: unknown }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(res, 400, { error: { message: 'body must be JSON {method, params}' } })
      }
      if (typeof body.method !== 'string') return send(res, 400, { error: { message: 'method must be a string' } })
      try {
        const result = body.method === 'status' && caller.status
          ? caller.status()
          : await caller.call(body.method, (body.params ?? {}) as Record<string, unknown>)
        send(res, 200, { result })
      } catch (err) {
        send(res, 200, { error: { message: err instanceof Error ? err.message : String(err) } })
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host ?? '127.0.0.1', () => {
      const addr = server.address()
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : options.port })
    })
  })
}
