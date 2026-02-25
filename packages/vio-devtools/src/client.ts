interface VioAppLike {
  getState(instanceId: string): Record<string, unknown>
  setState(instanceId: string, partial: Record<string, unknown>): void
  getStore(): Record<string, unknown>
  dispatch(action: string, payload?: unknown): void
  navigate(path: string): void
  getComponentTree(): { id: string; name: string; state: Record<string, unknown>; children: unknown[] }
  getRegisteredComponents(): string[]
  removeComponent(instanceId: string): void
  batch(ops: { action: string; target?: string; payload?: unknown }[]): void
  emit(event: string, payload?: Record<string, unknown>): void
  on(event: string, handler: (e: unknown) => void): () => void
  getEventHistory(): { type: string; payload: Record<string, unknown>; timestamp: number }[]
}

interface WsRequest {
  id: number
  method: string
  params: Record<string, unknown>
}

export interface DevtoolsConnection {
  disconnect(): void
  readonly ws: WebSocket
}

const DEFAULT_PORT = 3100

type MethodHandler = (app: VioAppLike, params: Record<string, unknown>) => unknown

const METHOD_MAP: Record<string, MethodHandler> = {
  getState: (app, p) => app.getState(p.instanceId as string),
  setState: (app, p) => { app.setState(p.instanceId as string, p.state as Record<string, unknown>); return { success: true } },
  getStore: (app) => app.getStore(),
  dispatch: (app, p) => { app.dispatch(p.action as string, p.payload); return { success: true } },
  navigate: (app, p) => { app.navigate(p.path as string); return { success: true } },
  getComponentTree: (app) => app.getComponentTree(),
  getRegisteredComponents: (app) => app.getRegisteredComponents(),
  removeComponent: (app, p) => { app.removeComponent(p.instanceId as string); return { success: true } },
  batch: (app, p) => { app.batch(p.operations as any); return { success: true } },
  emit: (app, p) => { app.emit(p.event as string, p.payload as Record<string, unknown>); return { success: true } },
  getEventHistory: (app) => app.getEventHistory()
}

export function connectDevtools(app: VioAppLike, options?: { port?: number }): DevtoolsConnection {
  const port = options?.port ?? DEFAULT_PORT
  const ws = new WebSocket(`ws://localhost:${port}`)

  ws.onmessage = (event: MessageEvent | { data: string }) => {
    const data = typeof event === 'object' && 'data' in event ? event.data : event
    const req = JSON.parse(data as string) as WsRequest
    const handler = METHOD_MAP[req.method]

    if (!handler) {
      ws.send(JSON.stringify({ id: req.id, error: { message: `Unknown method: ${req.method}` } }))
      return
    }

    try {
      const result = handler(app, req.params)
      ws.send(JSON.stringify({ id: req.id, result }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ws.send(JSON.stringify({ id: req.id, error: { message } }))
    }
  }

  return {
    disconnect() {
      ws.close()
    },
    get ws() {
      return ws
    }
  }
}
