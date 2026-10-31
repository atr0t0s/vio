import type { AppConfig, ComponentDef, BatchOperation, ComponentTreeNode, RouteInfo } from './types'
import { ComponentRegistry } from './component'
import { Renderer } from './renderer'
import { EventBus } from '../runtime/event-bus'
import { Store } from '../reactivity/store'
import { Router } from '../router/router'
import { Snapshotter } from '../agent/snapshot'
import type { SeeOptions, ActKind } from '../agent/snapshot'
import { getPointer, deepEqual, short, settle, waitFor, applyPatch } from '../agent/protocol'
import type { AssertCondition, AssertResult, PatchOp } from '../agent/protocol'
import { toPlain } from './renderer'

export interface Manifest {
  route: string | null
  /** Guarded routes are suffixed with " (guard)". */
  routes: string[]
  /** Store action name → "params · doc · confirm" (empty when undocumented). */
  actions: Record<string, string>
  /** Component names currently mounted. */
  components: string[]
  /** Usage notes from mounted components that define `doc` (e.g. a spec view's catalog). */
  docs?: Record<string, string>
}

export interface VioApp {
  mount(): void
  /** Unmount everything, remove listeners, and clear the event bus. */
  destroy(): void
  setState(instanceId: string, partial: Record<string, unknown>): void
  /** Apply a JSON Patch to a component's state (e.g. edit a spec in place); all-or-nothing. */
  patchState(instanceId: string, ops: PatchOp[]): void
  getState(instanceId: string): Record<string, unknown>
  dispatch(action: string, payload?: unknown): void
  getStore(): Record<string, unknown>
  on(event: string, handler: (e: any) => void): () => void
  emit(event: string, payload?: Record<string, unknown>): void
  register(def: ComponentDef): void
  getRegisteredComponents(): string[]
  removeComponent(instanceId: string): void
  getComponentTree(): ComponentTreeNode
  getRoute(): RouteInfo | null
  /** Returns false (and renders nothing) when no route matches. */
  navigate(path: string): boolean
  /** Validates every op first, then applies them with a single render. */
  batch(ops: BatchOperation[]): void
  getEventHistory(): { type: string; payload: Record<string, unknown>; timestamp: number }[]

  // --- Agent protocol ---
  /** Compact text snapshot with refs (`button#e5 "Add"`); `{ diff: true }` returns only changes. */
  see(opts?: SeeOptions): string
  /** Ref for a `role:name` query like `button:Add` or `item:Milk>button:Delete`. */
  find(query: string): string
  /** Act on an element by ref or `role:name` query, then return a snapshot diff. */
  act(ref: string, action: ActKind, value?: string): Promise<string>
  /** Run a named store action (checking `confirm` policy), then return a snapshot diff. */
  invoke(action: string, payload?: unknown, opts?: { confirm?: boolean }): Promise<string>
  /** Wait until a condition holds (default 1s); never throws for a failed check. */
  assert(cond: AssertCondition): Promise<AssertResult>
  /** Routes, actions, and mounted components in one small object. */
  manifest(): Manifest
}

const BATCH_ACTIONS = new Set(['setState', 'removeComponent', 'dispatch', 'navigate'])

function hashPath(): string {
  return window.location.hash.replace(/^#/, '') || '/'
}

export function createApp(config: AppConfig): VioApp {
  const bus = new EventBus({ historySize: 100 })
  const registry = new ComponentRegistry()

  const rootEl = typeof config.root === 'string'
    ? document.querySelector(config.root) as HTMLElement
    : config.root

  if (!rootEl) throw new Error(`Root element "${config.root}" not found`)

  const store = config.store ? new Store(config.store, bus) : null
  const router = config.routes ? new Router(config.routes, bus) : null
  let route: RouteInfo | null = null
  // Path (with query) of the last navigation, used to ignore our own hashchange echoes.
  let lastPath: string | null = null

  const renderer = new Renderer(rootEl, bus, {
    getStore: store ? () => store.getState() : undefined,
    dispatch: store ? (action, payload) => store.dispatch(action, payload) : undefined,
    getRoute: () => route ?? { path: '/', params: {}, query: {} },
    // Subscribe directly: bus listeners are error-isolated, render errors must reach the caller.
    subscribeStore: store ? (cb) => store.subscribe(cb) : undefined
  })

  if (router && store) {
    router.setStoreGetter(() => store.getState())
  }

  let hashCleanup: (() => void) | null = null

  const snap = new Snapshotter(rootEl, () => `route=${lastPath ?? '-'}`)

  function mountedDocs(): { names: string[]; docs: Record<string, string> } {
    const names = new Set<string>()
    const docs: Record<string, string> = {}
    const visit = (node: ComponentTreeNode) => {
      if (node.name) names.add(node.name)
      const doc = renderer.getInstance(node.id)?.def.doc
      if (doc) docs[node.id] = doc
      node.children.forEach(visit)
    }
    const tree = renderer.getTree()
    if (tree) visit(tree)
    return { names: [...names], docs }
  }

  function check(cond: AssertCondition): AssertResult {
    const fail = (detail: string): AssertResult => ({ pass: false, detail })
    const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()
    // textContent glues adjacent elements together ("AddAll"); join text nodes with spaces instead.
    const textOf = (el: Node) => {
      const parts: string[] = []
      const walker = el.ownerDocument!.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
      return norm(parts.join(' '))
    }

    if (cond.ref !== undefined) {
      const el = snap.resolve(cond.ref) as HTMLInputElement
      if (cond.text !== undefined && !textOf(el).includes(norm(cond.text))) return fail(`${cond.ref} text is ${short(textOf(el))}`)
      if (cond.value !== undefined && el.value !== cond.value) return fail(`${cond.ref} value is ${short(el.value)}`)
      if (cond.checked !== undefined && el.checked !== cond.checked) return fail(`${cond.ref} checked is ${el.checked}`)
    } else if (cond.text !== undefined) {
      const page = textOf(rootEl)
      if (!page.includes(norm(cond.text))) return fail(`text not found; page: ${short(page)}`)
    }
    if (cond.route !== undefined && route?.path !== cond.route) return fail(`route is ${route?.path ?? 'none'}`)
    if (cond.state !== undefined) {
      if (cond.of !== undefined && !renderer.getInstance(cond.of)) return fail(`no instance "${cond.of}"`)
      const doc = cond.of !== undefined ? renderer.getInstance(cond.of)!.state : (store?.getState() ?? {})
      const value = getPointer(doc, cond.state)
      if ('equals' in cond) {
        if (!deepEqual(toPlain(value), cond.equals)) return fail(`${cond.state} is ${short(value)}`)
      } else if (value === undefined) {
        return fail(`${cond.state} is missing`)
      }
    }
    if (cond.role !== undefined) {
      const n = snap.count(cond.role)
      if (cond.count !== undefined ? n !== cond.count : n === 0) return fail(`${n} ${cond.role}`)
    }
    return { pass: true }
  }

  function navigateTo(path: string): boolean {
    if (!router) return false
    const match = router.navigate(path)
    const rootId = renderer.getRootId()

    if (!match) {
      route = null
      lastPath = path
      if (rootId) renderer.unmount(rootId)
      bus.emit('route:notfound', { path })
      return false
    }

    route = { path: match.path, params: match.params, query: match.query }
    const search = new URLSearchParams(match.query).toString()
    lastPath = match.path + (search ? '?' + search : '')
    const props = { params: match.params, query: match.query }
    const current = rootId ? renderer.getInstance(rootId) : undefined

    // Same component on the next route keeps its instance and local state.
    if (current && current.def === match.component) {
      renderer.setProps(current.id, props)
    } else {
      if (rootId) renderer.unmount(rootId)
      renderer.mount(match.component, undefined, props)
    }
    return true
  }

  function syncHash(): void {
    if (lastPath !== null && hashPath() !== lastPath) {
      window.location.hash = '#' + lastPath
    }
  }

  return {
    mount() {
      if (!router) return
      navigateTo(hashPath())
      syncHash()

      const onHashChange = () => {
        const path = hashPath()
        if (path === lastPath) return
        navigateTo(path)
        syncHash()
      }

      window.addEventListener('hashchange', onHashChange)
      hashCleanup = () => {
        window.removeEventListener('hashchange', onHashChange)
        hashCleanup = null
      }
    },

    destroy() {
      hashCleanup?.()
      renderer.destroy()
      bus.emit('app:destroy', {})
      bus.clear()
      route = null
      lastPath = null
    },

    setState(instanceId, partial) {
      renderer.setState(instanceId, partial)
    },

    patchState(instanceId, ops) {
      const inst = renderer.getInstance(instanceId)
      if (!inst) throw new Error(`E_NO_INSTANCE: no instance with id "${instanceId}"`)
      const next = applyPatch(inst.state, ops)
      if (next === null || typeof next !== 'object' || Array.isArray(next)) throw new Error('E_PATCH: component state must stay an object')
      // setState merges, so keys removed by the patch must be cleared explicitly.
      const cleared = Object.fromEntries(Object.keys(inst.state).filter(k => !(k in next)).map(k => [k, undefined]))
      renderer.setState(instanceId, { ...cleared, ...next })
    },

    getState(instanceId) {
      const inst = renderer.getInstance(instanceId)
      return inst ? { ...inst.state } : {}
    },

    dispatch(action, payload?) {
      if (!store) throw new Error('No store configured')
      store.dispatch(action, payload)
    },

    getStore() {
      if (!store) return {}
      return store.getState()
    },

    on(event, handler) {
      return bus.on(event, handler)
    },

    emit(event, payload = {}) {
      bus.emit(event, payload)
    },

    register(def) {
      registry.register(def)
    },

    getRegisteredComponents() {
      return registry.list()
    },

    removeComponent(instanceId) {
      const wasRoot = instanceId === renderer.getRootId()
      renderer.unmount(instanceId)
      if (wasRoot) hashCleanup?.()
    },

    getComponentTree() {
      return renderer.getTree() ?? { id: '', name: '', state: {}, children: [] }
    },

    getRoute() {
      return route ? { ...route } : null
    },

    navigate(path) {
      if (!router) throw new Error('No routes configured')
      const ok = navigateTo(path)
      syncHash()
      return ok
    },

    batch(ops) {
      // Validate everything up front so a bad op cannot leave a half-applied batch.
      ops.forEach((op, i) => {
        const at = `batch[${i}]`
        if (!BATCH_ACTIONS.has(op.action)) {
          throw new Error(`E_BATCH_ACTION ${at}: unknown action "${op.action}" (use ${[...BATCH_ACTIONS].join(', ')})`)
        }
        if ((op.action === 'setState' || op.action === 'removeComponent') && !(op.target && renderer.getInstance(op.target))) {
          throw new Error(`E_NO_INSTANCE ${at}: no instance with id "${op.target}"`)
        }
        if (op.action === 'dispatch') {
          const name = (op.payload as { action?: string } | undefined)?.action
          if (!store) throw new Error(`E_NO_STORE ${at}: no store configured`)
          if (!name || !store.hasAction(name)) throw new Error(`E_UNKNOWN_ACTION ${at}: unknown store action "${name}"`)
        }
        if (op.action === 'navigate' && (!router || !op.target)) {
          throw new Error(`E_NAVIGATE ${at}: ${router ? 'missing target path' : 'no routes configured'}`)
        }
      })

      bus.emit('batch:start', { operations: ops.length })
      let navigated = false
      const savedStore = store?.getState()
      const savedStates = renderer.captureStates()
      try {
        renderer.batch(() => {
          for (const op of ops) {
            switch (op.action) {
              case 'setState':
                renderer.setState(op.target!, op.payload as Record<string, unknown>)
                break
              case 'dispatch': {
                const p = op.payload as { action: string; payload?: unknown; value?: unknown }
                store!.dispatch(p.action, 'payload' in p ? p.payload : p.value)
                break
              }
              case 'removeComponent':
                renderer.unmount(op.target!)
                break
              case 'navigate':
                navigateTo(op.target!)
                navigated = true
                break
            }
          }
        })
      } catch (err) {
        // State ops are undone; unmounts and navigation are not reversible.
        if (store && savedStore) store.replace(savedStore)
        renderer.restoreStates(savedStates)
        bus.emit('batch:end', { operations: ops.length, error: err instanceof Error ? err.message : String(err) })
        throw err
      }
      if (navigated) syncHash()
      bus.emit('batch:end', { operations: ops.length })
    },

    getEventHistory() {
      return bus.getHistory()
    },

    see(opts) {
      return snap.see(opts)
    },

    find(query) {
      return snap.find(query)
    },

    async act(ref, action, value) {
      snap.act(ref, action, value)
      await settle()
      return snap.see({ diff: true })
    },

    async invoke(action, payload, opts) {
      if (!store) throw new Error('E_NO_STORE: no store configured')
      if (!store.hasAction(action)) {
        throw new Error(`E_UNKNOWN_ACTION: "${action}"; available: ${store.actionNames().join(', ')}`)
      }
      if (store.meta[action]?.confirm && !opts?.confirm) {
        throw new Error(`E_CONFIRM: "${action}" needs confirmation; ask the user, then call again with { confirm: true }`)
      }
      store.dispatch(action, payload)
      await settle()
      return snap.see({ diff: true })
    },

    assert(cond) {
      return waitFor(() => check(cond), cond)
    },

    manifest() {
      const actions: Record<string, string> = {}
      for (const name of store?.actionNames() ?? []) {
        const m = store!.meta[name]
        actions[name] = m ? [m.params, m.doc, m.confirm ? 'confirm' : ''].filter(Boolean).join(' · ') : ''
      }
      const { names, docs } = mountedDocs()
      const manifest: Manifest = {
        route: lastPath,
        routes: (config.routes ?? []).map(r => r.guard ? `${r.path} (guard)` : r.path),
        actions,
        components: names
      }
      if (Object.keys(docs).length) manifest.docs = docs
      return manifest
    }
  }
}
