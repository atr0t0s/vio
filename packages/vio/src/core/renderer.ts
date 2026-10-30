import type {
  VioNodeDescriptor,
  VioChild,
  ComponentDef,
  ComponentInstance,
  ComponentContext,
  ComponentTreeNode,
  RenderFunction,
  RouteInfo
} from './types'
import { EventBus } from '../runtime/event-bus'
import {
  childNamespace,
  createDomElement,
  isBlockedTag,
  namespaceForChildren,
  updateProps
} from './dom'
import type { UnsafeReporter } from './dom'

export interface RendererOptions {
  getStore?: () => Record<string, unknown>
  dispatch?: (action: string, payload?: unknown) => void
  getRoute?: () => RouteInfo
  /** Store change source; defaults to listening for `store:change` on the bus. */
  subscribeStore?: (onChange: () => void) => () => void
  /** Maximum element/component nesting before rendering fails with E_DEPTH. */
  maxDepth?: number
}

type Key = string | number

type VNode =
  | { k: 'text'; text: string; dom: Text; key?: undefined }
  | { k: 'empty'; dom: Comment; key?: undefined }
  | { k: 'el'; tag: string; key?: Key; props: Record<string, unknown>; children: VNode[]; dom: Element }
  | { k: 'comp'; def: ComponentDef; key?: Key; inst: Instance }

type Desc = string | VioNodeDescriptor | null

interface Instance extends ComponentInstance {
  vnode: VNode | null
  parent: Instance | null
  depth: number
  ns: string | null
  refs: Map<string, Element>
  ctx: ComponentContext
  alive: boolean
}

const EMPTY_ROUTE: RouteInfo = { path: '/', params: {}, query: {} }
const DEFAULT_MAX_DEPTH = 512
const MAX_FLUSH_PASSES = 100

// Bare render functions used as tags get a stable synthetic definition.
const fnDefs = new WeakMap<RenderFunction, ComponentDef>()

function defFor(tag: RenderFunction | ComponentDef): ComponentDef {
  if (typeof tag !== 'function') return tag
  let def = fnDefs.get(tag)
  if (!def) {
    def = { name: tag.name || 'Anonymous', state: {}, render: tag }
    fnDefs.set(tag, def)
  }
  return def
}

function normalizeChildren(children: VioChild[] | undefined, out: Desc[] = []): Desc[] {
  if (!children) return out
  for (const child of children) {
    if (Array.isArray(child)) normalizeChildren(child, out)
    else if (child === null || child === undefined || child === false || child === true || child === '') continue
    else if (typeof child === 'string' || typeof child === 'number') out.push(String(child))
    else if (typeof child === 'object' && 'tag' in child) out.push(child)
  }
  return out
}

function keyOf(desc: Desc): Key | undefined {
  if (desc === null || typeof desc === 'string') return undefined
  const k = desc.key ?? desc.props?.key
  return typeof k === 'string' || typeof k === 'number' ? k : undefined
}

function propsOf(desc: VioNodeDescriptor): Record<string, unknown> {
  return desc.props ?? {}
}

function domOf(v: VNode): Node {
  return v.k === 'comp' ? (v.inst.vnode ? domOf(v.inst.vnode) : document.createComment('')) : v.dom
}

function sameType(v: VNode, desc: Desc): boolean {
  if (desc === null) return v.k === 'empty'
  if (typeof desc === 'string') return v.k === 'text'
  if (typeof desc.tag === 'string') return v.k === 'el' && v.tag === desc.tag
  return v.k === 'comp' && v.def === defFor(desc.tag) && v.inst.alive
}

/** Indices (into `seq`) of a longest strictly increasing subsequence, ignoring -1 entries. */
function lis(seq: number[]): Set<number> {
  const tails: number[] = []
  const prev: number[] = new Array(seq.length).fill(-1)
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i]!
    if (v < 0) continue
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (seq[tails[mid]!]! < v) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]!
    tails[lo] = i
  }
  const result = new Set<number>()
  let i = tails.length ? tails[tails.length - 1]! : -1
  while (i >= 0) {
    result.add(i)
    i = prev[i]!
  }
  return result
}

export class VioError extends Error {
  constructor(public code: string, message: string, public componentId?: string, options?: { cause?: unknown }) {
    super(`${code}${componentId ? ` ${componentId}` : ''}: ${message}`, options)
    this.name = 'VioError'
  }
}

export class Renderer {
  private container: HTMLElement
  private bus: EventBus
  private options: RendererOptions
  private instances = new Map<string, Instance>()
  private topLevel: Instance[] = []
  private rootInstanceId: string | null = null
  private pendingMounts: Instance[] = []
  private dirty = new Set<Instance>()
  private pendingUpdates: [Instance, Record<string, unknown>][] = []
  private batchDepth = 0
  private flushing = false
  private report: UnsafeReporter
  private unsubscribeStore: () => void

  constructor(container: HTMLElement, bus: EventBus, options: RendererOptions = {}) {
    this.container = container
    this.bus = bus
    this.options = options
    this.report = (reason, detail) => this.bus.emit('security:blocked', { reason, ...detail })

    // A store change re-renders from each top-level instance; children follow via reconciliation.
    const onStoreChange = () => {
      for (const inst of this.topLevel) this.schedule(inst)
    }
    this.unsubscribeStore = options.subscribeStore
      ? options.subscribeStore(onStoreChange)
      : this.bus.on('store:change', onStoreChange)
  }

  /**
   * Mount a top-level component. Without `parentEl` it becomes the root and
   * replaces the container's contents; with `parentEl` it is appended there.
   */
  mount(def: ComponentDef, parentEl?: HTMLElement, props: Record<string, unknown> = {}): ComponentInstance {
    const inst = this.batch(() => {
      const inst = this.createInstance(def, props, undefined, null, null, 0)
      const dom = domOf(inst.vnode!)
      if (parentEl) {
        parentEl.appendChild(dom)
      } else {
        this.rootInstanceId = inst.id
        this.container.textContent = ''
        this.container.appendChild(dom)
      }
      this.topLevel.push(inst)
      return inst
    })
    return inst
  }

  setState(instanceId: string, partial: Record<string, unknown>): void {
    const inst = this.instances.get(instanceId)
    if (!inst) throw new VioError('E_NO_INSTANCE', `no instance with id "${instanceId}"`)

    const prevState = { ...inst.state }
    inst.state = { ...inst.state, ...partial }

    this.bus.emit('state:change', {
      component: inst.def.name,
      id: instanceId,
      prev: prevState,
      next: { ...inst.state }
    })

    if (inst.def.onUpdate) this.pendingUpdates.push([inst, prevState])
    this.schedule(inst)
  }

  /** Replace a top-level instance's props (e.g. new route params) and re-render it. */
  setProps(instanceId: string, props: Record<string, unknown>): void {
    const inst = this.instances.get(instanceId)
    if (!inst) throw new VioError('E_NO_INSTANCE', `no instance with id "${instanceId}"`)
    inst.props = props
    this.schedule(inst)
  }

  unmount(instanceId: string): void {
    const inst = this.instances.get(instanceId)
    if (!inst) return
    const dom = inst.vnode ? domOf(inst.vnode) : null
    this.destroyInstance(inst)
    dom?.parentNode?.removeChild(dom)
    this.topLevel = this.topLevel.filter(i => i !== inst)
    if (this.rootInstanceId === instanceId) this.rootInstanceId = null
  }

  /** Unmount everything and detach from the bus. */
  destroy(): void {
    for (const inst of [...this.topLevel]) this.unmount(inst.id)
    this.unsubscribeStore()
    this.dirty.clear()
    this.pendingUpdates = []
  }

  /** Copy of every live instance's state, for rollback. */
  captureStates(): Map<string, Record<string, unknown>> {
    return new Map([...this.instances].map(([id, inst]) => [id, inst.state]))
  }

  /** Put back states captured earlier; instances that no longer exist are skipped. */
  restoreStates(saved: Map<string, Record<string, unknown>>): void {
    this.batch(() => {
      for (const [id, state] of saved) {
        const inst = this.instances.get(id)
        if (inst && inst.state !== state) {
          inst.state = state
          this.schedule(inst)
        }
      }
    })
  }

  getInstance(instanceId: string): ComponentInstance | undefined {
    return this.instances.get(instanceId)
  }

  getRootId(): string | null {
    return this.rootInstanceId
  }

  /** Run `fn` with rendering deferred; all resulting updates render once at the end. */
  batch<T>(fn: () => T): T {
    this.batchDepth++
    try {
      return fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0) this.flush()
    }
  }

  getTree(instanceId: string | null = this.rootInstanceId): ComponentTreeNode | null {
    const inst = instanceId ? this.instances.get(instanceId) : undefined
    if (!inst) return null
    const node: ComponentTreeNode = {
      id: inst.id,
      name: inst.def.name,
      state: toPlain(inst.state) as Record<string, unknown>,
      children: inst.childIds.map(id => this.getTree(id)).filter((n): n is ComponentTreeNode => n !== null)
    }
    const props = toPlain(inst.props) as Record<string, unknown>
    if (Object.keys(props).length > 0) node.props = props
    if (inst.key !== undefined) node.key = inst.key
    return node
  }

  // --- scheduling ---

  private schedule(inst: Instance): void {
    this.dirty.add(inst)
    if (this.batchDepth === 0 && !this.flushing) this.flush()
  }

  private flush(): void {
    if (this.flushing) return
    this.flushing = true
    try {
      let passes = 0
      while (this.dirty.size > 0 || this.pendingMounts.length > 0 || this.pendingUpdates.length > 0) {
        if (++passes > MAX_FLUSH_PASSES) {
          this.dirty.clear()
          this.pendingUpdates = []
          throw new VioError('E_UPDATE_LOOP', `state kept changing after ${MAX_FLUSH_PASSES} render passes`)
        }
        const dirty = [...this.dirty].sort((a, b) => a.depth - b.depth)
        this.dirty.clear()
        const rendered = new Set<Instance>()
        for (const inst of dirty) {
          if (!inst.alive || this.hasAncestorIn(inst, rendered)) continue
          try {
            this.rerender(inst)
          } catch (err) {
            this.escalate(inst, err)
          }
          rendered.add(inst)
        }
        this.flushMounts()
        const updates = this.pendingUpdates
        this.pendingUpdates = []
        for (const [inst, prev] of updates) {
          if (inst.alive) this.runHook(inst, 'onUpdate', () => inst.def.onUpdate!(inst.ctx, prev))
        }
      }
    } finally {
      this.flushing = false
    }
  }

  private hasAncestorIn(inst: Instance, set: Set<Instance>): boolean {
    for (let p = inst.parent; p; p = p.parent) if (set.has(p)) return true
    return false
  }

  private flushMounts(): void {
    const mounts = this.pendingMounts
    this.pendingMounts = []
    for (const inst of mounts) {
      if (!inst.alive) continue
      this.bus.emit('component:mount', { name: inst.def.name, id: inst.id, state: { ...inst.state } })
      if (inst.def.onMount) {
        this.runHook(inst, 'onMount', () => {
          const cleanup = inst.def.onMount!(inst.ctx)
          if (typeof cleanup === 'function') inst.cleanup = cleanup
        })
      }
    }
  }

  private runHook(inst: Instance, phase: string, fn: () => void): void {
    try {
      fn()
    } catch (err) {
      throw this.componentError(inst, phase, err)
    }
  }

  private componentError(inst: Instance, phase: string, err: unknown): unknown {
    if (err instanceof VioError) return err
    const message = err instanceof Error ? err.message : String(err)
    this.bus.emit('component:error', { id: inst.id, name: inst.def.name, phase, message })
    return new VioError('E_' + phase.replace(/^on/, '').toUpperCase(), message, inst.id, { cause: err })
  }

  // --- instances ---

  private createInstance(
    def: ComponentDef,
    props: Record<string, unknown>,
    key: Key | undefined,
    parent: Instance | null,
    ns: string | null,
    depth: number
  ): Instance {
    const id = this.makeId(def.name, key, parent)
    const inst = {
      id,
      def,
      state: { ...(def.state ?? {}) },
      props,
      node: null,
      element: null,
      parentId: parent?.id ?? null,
      childIds: [],
      key,
      vnode: null,
      parent,
      depth,
      ns,
      refs: new Map(),
      alive: true
    } as unknown as Instance
    inst.ctx = this.createContext(inst)

    this.instances.set(id, inst)
    parent?.childIds.push(id)

    try {
      inst.vnode = this.create(this.renderInstance(inst), inst, ns, depth + 1)
    } catch (err) {
      inst.vnode = this.recover(inst, err, null)
    }
    inst.element = this.elementOf(inst.vnode)
    this.pendingMounts.push(inst)
    return inst
  }

  private makeId(name: string, key: Key | undefined, parent: Instance | null): string {
    const base = parent ? `${parent.id}/${name}` : name
    let id = key !== undefined ? `${base}[${key}]` : base
    if (key === undefined && parent) {
      const siblings = parent.childIds.filter(c => this.instances.get(c)?.def.name === name).length
      if (siblings > 0) id = `${base}.${siblings}`
    }
    let n = 1
    let candidate = id
    while (this.instances.has(candidate)) candidate = `${id}~${++n}`
    return candidate
  }

  private renderInstance(inst: Instance): Desc {
    let out: VioNodeDescriptor | null
    try {
      // Props override same-named state keys (v2 behavior); prefer ctx.props in new code.
      out = inst.def.render({ ...inst.state, ...inst.props }, inst.ctx)
    } catch (err) {
      throw this.componentError(inst, 'render', err)
    }
    inst.node = out ?? null
    return out ?? null
  }

  private rerender(inst: Instance): void {
    const old = inst.vnode
    try {
      const desc = this.renderInstance(inst)
      inst.vnode = old ? this.patch(old, desc, inst, inst.ns, inst.depth + 1) : this.create(desc, inst, inst.ns, inst.depth + 1)
    } catch (err) {
      inst.vnode = this.recover(inst, err, old)
    }
    inst.element = this.elementOf(inst.vnode)
  }

  /**
   * Error boundary: if `inst` defines onError, drop its whole subtree and
   * render the fallback in its place. Otherwise rethrow to the caller, which is
   * the parent's render when this ran as part of it.
   */
  private recover(inst: Instance, err: unknown, old: VNode | null): VNode {
    if (!inst.def.onError) throw err
    for (const id of [...inst.childIds]) {
      const child = this.instances.get(id)
      if (child) this.destroyInstance(child)
    }
    const error = err instanceof Error ? err : new Error(String(err))
    let fallback: VioNodeDescriptor | null
    try {
      fallback = inst.def.onError(error, inst.ctx)
    } catch (e) {
      throw this.componentError(inst, 'onError', e)
    }
    const v = this.create(fallback ?? null, inst, inst.ns, inst.depth + 1)
    if (old) {
      const oldDom = domOf(old)
      oldDom.parentNode?.replaceChild(domOf(v), oldDom)
    }
    this.bus.emit('component:error', { id: inst.id, name: inst.def.name, phase: 'boundary', message: error.message, handled: true })
    return v
  }

  /** A component re-rendered on its own threw: hand the error to the nearest ancestor boundary. */
  private escalate(inst: Instance, err: unknown): void {
    for (let b = inst.parent; b; b = b.parent) {
      if (b.def.onError && b.alive) {
        b.vnode = this.recover(b, err, b.vnode)
        b.element = this.elementOf(b.vnode)
        return
      }
    }
    throw err
  }

  private elementOf(v: VNode): Element | null {
    const dom = domOf(v)
    return dom instanceof Element ? dom : null
  }

  private destroyInstance(inst: Instance): void {
    if (!inst.alive) return
    if (inst.vnode) this.destroyVNode(inst.vnode)
    // Instances created by a render that threw are not in the vnode tree yet.
    for (const id of [...inst.childIds]) {
      const child = this.instances.get(id)
      if (child) this.destroyInstance(child)
    }
    inst.alive = false
    try {
      inst.cleanup?.()
      inst.def.onUnmount?.(inst.ctx)
    } catch (err) {
      throw this.componentError(inst, 'onUnmount', err)
    } finally {
      this.instances.delete(inst.id)
      if (inst.parent) inst.parent.childIds = inst.parent.childIds.filter(c => c !== inst.id)
      this.bus.emit('component:unmount', { name: inst.def.name, id: inst.id })
    }
  }

  private createContext(inst: Instance): ComponentContext {
    const renderer = this
    return {
      get id() { return inst.id },
      get props() { return inst.props },
      get store() { return renderer.options.getStore?.() ?? {} },
      get route() { return renderer.options.getRoute?.() ?? EMPTY_ROUTE },
      setState: (partial) => {
        if (!inst.alive) return
        this.setState(inst.id, partial)
      },
      getState: () => ({ ...inst.state }),
      dispatch: (action, payload) => {
        if (!this.options.dispatch) throw new VioError('E_NO_STORE', `cannot dispatch "${action}": no store configured`, inst.id)
        this.options.dispatch(action, payload)
      },
      emit: (event, payload) => {
        const payloadObj = typeof payload === 'object' && payload !== null
          ? payload as Record<string, unknown>
          : { value: payload }
        this.bus.emit(event, { component: inst.id, ...payloadObj })
      },
      getRef: (name) => {
        const el = inst.refs.get(name)
        return el && el.isConnected ? el : null
      }
    }
  }

  // --- virtual nodes ---

  private create(desc: Desc, owner: Instance, ns: string | null, depth: number): VNode {
    if (depth > (this.options.maxDepth ?? DEFAULT_MAX_DEPTH)) {
      throw new VioError('E_DEPTH', `tree depth exceeds ${this.options.maxDepth ?? DEFAULT_MAX_DEPTH}`, owner.id)
    }
    if (desc === null) return { k: 'empty', dom: document.createComment('') }
    if (typeof desc === 'string') return { k: 'text', text: desc, dom: document.createTextNode(desc) }

    const key = keyOf(desc)
    if (typeof desc.tag !== 'string') {
      const def = defFor(desc.tag)
      const inst = this.createInstance(def, propsOf(desc), key, owner, ns, depth)
      return { k: 'comp', def, key, inst }
    }

    const tag = desc.tag
    if (isBlockedTag(tag)) {
      this.report('blocked-tag', { tag, component: owner.id })
      return { k: 'empty', dom: document.createComment('') }
    }
    const elNs = childNamespace(tag, ns)
    const dom = createDomElement(tag, elNs)
    const inner = namespaceForChildren(tag, elNs)
    const children = normalizeChildren(desc.children).map(c => this.create(c, owner, inner, depth + 1))
    for (const child of children) dom.appendChild(domOf(child))
    const props = propsOf(desc)
    // Props after children so <select value> can see its options.
    updateProps(dom, props, {}, this.report)
    this.bindRef(owner, props.ref, dom)
    return { k: 'el', tag, key, props, children, dom }
  }

  private patch(old: VNode, desc: Desc, owner: Instance, ns: string | null, depth: number): VNode {
    if (!sameType(old, desc)) {
      const next = this.create(desc, owner, ns, depth)
      const oldDom = domOf(old)
      const parent = oldDom.parentNode
      this.destroyVNode(old)
      if (parent) parent.replaceChild(domOf(next), oldDom)
      return next
    }

    switch (old.k) {
      case 'empty':
        return old
      case 'text': {
        const text = desc as string
        if (old.text !== text) {
          old.dom.data = text
          old.text = text
        }
        return old
      }
      case 'comp': {
        old.inst.props = propsOf(desc as VioNodeDescriptor)
        this.dirty.delete(old.inst)
        this.rerender(old.inst)
        return old
      }
      case 'el': {
        const d = desc as VioNodeDescriptor
        const props = propsOf(d)
        const elNs = childNamespace(old.tag, ns)
        old.children = this.reconcileChildren(old.dom, old.children, normalizeChildren(d.children), owner, namespaceForChildren(old.tag, elNs), depth + 1)
        updateProps(old.dom, props, old.props, this.report)
        this.bindRef(owner, props.ref, old.dom)
        old.props = props
        old.key = keyOf(d)
        return old
      }
    }
  }

  private reconcileChildren(parentDom: Element, oldCh: VNode[], newCh: Desc[], owner: Instance, ns: string | null, depth: number): VNode[] {
    const keyed = new Map<Key, number>()
    const unkeyed: number[] = []
    oldCh.forEach((v, i) => {
      if (v.key !== undefined && !keyed.has(v.key)) keyed.set(v.key, i)
      else unkeyed.push(i)
    })

    const used = new Array<boolean>(oldCh.length).fill(false)
    const sources: number[] = []
    const result: VNode[] = []
    let u = 0

    for (const desc of newCh) {
      const key = keyOf(desc)
      let oi = -1
      if (key !== undefined) {
        const i = keyed.get(key)
        if (i !== undefined && !used[i] && sameType(oldCh[i]!, desc)) oi = i
      } else {
        while (u < unkeyed.length && used[unkeyed[u]!]) u++
        if (u < unkeyed.length) oi = unkeyed[u++]!
      }

      if (oi >= 0) {
        used[oi] = true
        const v = this.patch(oldCh[oi]!, desc, owner, ns, depth)
        // A patched node that ended up detached must be (re)inserted.
        sources.push(domOf(v).parentNode === parentDom ? oi : -1)
        result.push(v)
      } else {
        sources.push(-1)
        result.push(this.create(desc, owner, ns, depth))
      }
    }

    oldCh.forEach((v, i) => {
      if (!used[i]) this.removeVNode(v)
    })

    // Keep the longest already-ordered run in place; move or insert everything else.
    const stable = lis(sources)
    const focus = captureFocus(parentDom)
    let anchor: Node | null = null
    for (let j = result.length - 1; j >= 0; j--) {
      const dom = domOf(result[j]!)
      if (!stable.has(j) || sources[j] === -1) {
        if (dom.nextSibling !== anchor || dom.parentNode !== parentDom) parentDom.insertBefore(dom, anchor)
      }
      anchor = dom
    }
    focus?.()
    return result
  }

  private removeVNode(v: VNode): void {
    const dom = domOf(v)
    this.destroyVNode(v)
    dom.parentNode?.removeChild(dom)
  }

  private destroyVNode(v: VNode): void {
    if (v.k === 'comp') this.destroyInstance(v.inst)
    else if (v.k === 'el') for (const child of v.children) this.destroyVNode(child)
  }

  private bindRef(owner: Instance, ref: unknown, dom: Element): void {
    if (typeof ref === 'string') owner.refs.set(ref, dom)
    else if (typeof ref === 'function') (ref as (el: Element) => void)(dom)
  }
}

/** Moving a node blurs it; returns a function that restores focus and selection. */
function captureFocus(parent: Element): (() => void) | null {
  const active = parent.ownerDocument.activeElement as HTMLElement | null
  if (!active || active === parent || !parent.contains(active)) return null
  const field = active as HTMLInputElement
  let start: number | null = null
  let end: number | null = null
  try {
    start = field.selectionStart ?? null
    end = field.selectionEnd ?? null
  } catch {
    // selection is not supported on this input type
  }
  return () => {
    if (!active.isConnected || active.ownerDocument.activeElement === active) return
    active.focus()
    if (start !== null && end !== null) {
      try { field.setSelectionRange(start, end) } catch { /* not a text field */ }
    }
  }
}

/** JSON-safe copy for introspection: drops functions, breaks cycles, caps depth. */
export function toPlain(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' ? undefined : value
  }
  if (depth > 20 || seen.has(value)) return '[circular]'
  if (typeof Node !== 'undefined' && value instanceof Node) return `[${value.nodeName.toLowerCase()}]`
  seen.add(value)
  let out: unknown
  if (Array.isArray(value)) {
    out = value.map(v => toPlain(v, depth + 1, seen) ?? null)
  } else if (value instanceof Date) {
    out = value.toISOString()
  } else {
    const obj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const p = toPlain(v, depth + 1, seen)
      if (p !== undefined) obj[k] = p
    }
    out = obj
  }
  seen.delete(value)
  return out
}
