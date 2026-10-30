interface VioAppLike {
  getState(instanceId: string): Record<string, unknown>
  setState(instanceId: string, partial: Record<string, unknown>): void
  patchState?(instanceId: string, ops: unknown[]): void
  getStore(): Record<string, unknown>
  dispatch(action: string, payload?: unknown): void
  navigate(path: string): unknown
  getComponentTree(): { id: string; name: string; state: Record<string, unknown>; children: unknown[] }
  getRegisteredComponents(): string[]
  removeComponent(instanceId: string): void
  batch(ops: { action: string; target?: string; payload?: unknown }[]): void
  emit(event: string, payload?: Record<string, unknown>): void
  on(event: string, handler: (e: unknown) => void): () => void
  getEventHistory(): { type: string; payload: Record<string, unknown>; timestamp: number; seq?: number }[]
  manifest(): unknown
  see(opts?: Record<string, unknown>): string
  act(ref: string, action: string, value?: string): Promise<string>
  invoke(action: string, payload?: unknown, opts?: { confirm?: boolean }): Promise<string>
  assert(cond: Record<string, unknown>): Promise<unknown>
}

const ERROR_EVENTS = new Set(['component:error', 'listener:error', 'security:blocked', 'route:notfound'])

function pointer(doc: unknown, path?: string): unknown {
  if (!path || path === '/') return doc
  let cur = doc
  for (const raw of path.replace(/^\//, '').split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function compactEvents(events: { type: string; payload: Record<string, unknown>; seq?: number }[]): string {
  if (events.length === 0) return 'none'
  return events.map(e => {
    let payload = ''
    try { payload = JSON.stringify(e.payload) ?? '' } catch { payload = '[unserializable]' }
    if (payload.length > 120) payload = payload.slice(0, 119) + '…'
    return `${e.seq ?? ''} ${e.type} ${payload}`.trim()
  }).join('\n')
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
  navigate: (app, p) => ({ success: app.navigate(p.path as string) !== false }),
  getComponentTree: (app) => app.getComponentTree(),
  getRegisteredComponents: (app) => app.getRegisteredComponents(),
  removeComponent: (app, p) => { app.removeComponent(p.instanceId as string); return { success: true } },
  batch: (app, p) => { app.batch(p.operations as any); return { success: true } },
  emit: (app, p) => { app.emit(p.event as string, p.payload as Record<string, unknown>); return { success: true } },
  getEventHistory: (app) => app.getEventHistory(),

  // Agent contract (used by the MCP tools)
  manifest: (app) => app.manifest(),
  see: (app, p) => app.see(p),
  act: (app, p) => app.act(p.ref as string, p.action as string, p.value as string | undefined),
  invoke: (app, p) => app.invoke(p.action as string, p.payload, { confirm: p.confirm === true }),
  assert: (app, p) => app.assert(p),
  state: async (app, p) => {
    const id = p.id as string | undefined
    if (p.patch) {
      if (!id) throw new Error('E_STATE: patch needs a component id; change the store with vio_invoke')
      if (!app.patchState) throw new Error('E_STATE: this app version has no patchState')
      app.patchState(id, p.patch as unknown[])
      await new Promise(r => setTimeout(r, 0))
      return app.see({ diff: true })
    }
    if (p.set) {
      if (!id) throw new Error('E_STATE: set needs a component id; change the store with vio_invoke')
      app.setState(id, p.set as Record<string, unknown>)
    }
    return pointer(id ? app.getState(id) : app.getStore(), p.path as string | undefined) ?? null
  },
  nav: async (app, p) => {
    const ok = app.navigate(p.path as string)
    await new Promise(r => setTimeout(r, 0))
    if (ok === false) throw new Error(`E_NOT_FOUND: no route for "${p.path}"; see vio_manifest routes`)
    return app.see({ diff: true })
  },
  debug: (app, p) => {
    const limit = typeof p.limit === 'number' ? p.limit : 20
    if (p.what === 'tree') return app.getComponentTree()
    const history = app.getEventHistory()
    const events = p.what === 'errors' ? history.filter(e => ERROR_EVENTS.has(e.type)) : history
    return compactEvents(events.slice(-limit))
  }
}

export interface DevtoolsOptions {
  port?: number
  /** Must match VIO_DEVTOOLS_TOKEN on the server when that is set. */
  token?: string
  onError?: (err: Event) => void
}

export function connectDevtools(app: VioAppLike, options?: DevtoolsOptions): DevtoolsConnection {
  const port = options?.port ?? DEFAULT_PORT
  const query = options?.token ? `?token=${encodeURIComponent(options.token)}` : ''
  const ws = new WebSocket(`ws://127.0.0.1:${port}${query}`)

  ws.onerror = (err) => {
    if (options?.onError) {
      options.onError(err)
    } else {
      console.warn('[vio-devtools] WebSocket error — is the devtools server running?')
    }
  }

  ws.onmessage = (event: MessageEvent | { data: string }) => {
    const data = typeof event === 'object' && 'data' in event ? event.data : event
    let req: WsRequest
    try {
      req = JSON.parse(data as string) as WsRequest
    } catch {
      return
    }
    if (!req || typeof req.id !== 'number' || typeof req.method !== 'string') return
    const handler = Object.prototype.hasOwnProperty.call(METHOD_MAP, req.method) ? METHOD_MAP[req.method] : undefined

    if (!handler) {
      ws.send(JSON.stringify({ id: req.id, error: { message: `Unknown method: ${req.method}` } }))
      return
    }

    const reply = (result: unknown) => ws.send(JSON.stringify({ id: req.id, result }))
    const fail = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      ws.send(JSON.stringify({ id: req.id, error: { message } }))
    }
    try {
      const result = handler(app, req.params ?? {})
      if (result instanceof Promise) result.then(reply, fail)
      else reply(result)
    } catch (err) {
      fail(err)
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
