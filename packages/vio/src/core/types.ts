export type RenderFunction = (state: Record<string, unknown>, ctx: ComponentContext) => VioNodeDescriptor | null

export interface VioNodeDescriptor {
  tag: string | RenderFunction | ComponentDef
  props?: Record<string, unknown>
  children?: VioChild[]
  key?: string | number
}

export type VioChild = VioNodeDescriptor | string | number | boolean | null | undefined | VioChild[]

export interface ComponentDef {
  name: string
  state?: Record<string, unknown>
  render: RenderFunction
  onMount?: (ctx: ComponentContext) => void | (() => void)
  onUpdate?: (ctx: ComponentContext, prevState: Record<string, unknown>) => void
  onUnmount?: (ctx: ComponentContext) => void
  /**
   * Error boundary: called when this component or any descendant throws while
   * rendering. Return fallback UI; the next state/props change retries.
   */
  onError?: (error: Error, ctx: ComponentContext) => VioNodeDescriptor | null
}

export interface RouteInfo {
  path: string
  params: Record<string, string>
  query: Record<string, string>
}

/** Passed as the second argument to `render` and to every lifecycle hook. */
export interface ComponentContext {
  readonly id: string
  /** Props from the parent (route components get `{ params, query }`). */
  readonly props: Record<string, unknown>
  /** Snapshot of the global store (`{}` when none is configured). */
  readonly store: Record<string, unknown>
  readonly route: RouteInfo
  setState: (partial: Record<string, unknown>) => void
  getState: () => Record<string, unknown>
  dispatch: (action: string, payload?: unknown) => void
  emit: (event: string, payload?: unknown) => void
  /** Element registered with `props: { ref: 'name' }` in this component's output. */
  getRef: (name: string) => Element | null
}

export interface ComponentInstance {
  id: string
  def: ComponentDef
  state: Record<string, unknown>
  props: Record<string, unknown>
  /** Last descriptor returned by `render`. */
  node: VioNodeDescriptor | null
  element: Element | null
  parentId: string | null
  childIds: string[]
  key?: string | number
  cleanup?: () => void
}

export interface ComponentTreeNode {
  id: string
  name: string
  state: Record<string, unknown>
  props?: Record<string, unknown>
  key?: string | number
  children: ComponentTreeNode[]
}

/** Return `true` to allow, `false` to skip the route, or a path string to redirect. */
export type RouteGuard = (store: Record<string, unknown>) => boolean | string

export interface Route {
  path: string
  component: ComponentDef
  guard?: RouteGuard
}

export interface StoreAction {
  (state: Record<string, unknown>, payload?: unknown): Record<string, unknown>
}

export interface ActionMeta {
  /** One line for agents, e.g. "Add a todo". */
  doc?: string
  /** Payload shape in short form, e.g. "text:string" or "{id:number}". */
  params?: string
  /** `invoke` refuses to run it unless called with `{ confirm: true }`. */
  confirm?: boolean
}

export interface StoreConfig {
  state: Record<string, unknown>
  actions: Record<string, StoreAction>
  /** Agent-facing descriptions, surfaced by `app.manifest()`. */
  meta?: Record<string, ActionMeta>
  /** Deep-freeze state so accidental mutation throws. Default true. */
  freeze?: boolean
}

export interface AppConfig {
  root: string | HTMLElement
  routes?: Route[]
  store?: StoreConfig
}

export type VioEventType =
  | 'state:change'
  | 'store:change'
  | 'component:mount'
  | 'component:update'
  | 'component:unmount'
  | 'component:error'
  | 'route:before'
  | 'route:change'
  | 'route:after'
  | 'route:notfound'
  | 'security:blocked'
  | 'batch:start'
  | 'batch:end'
  | 'app:destroy'
  | 'listener:error'

export interface VioEvent {
  type: VioEventType | string
  payload: Record<string, unknown>
  timestamp: number
  /** Monotonic per bus; orders events emitted in the same millisecond. */
  seq: number
}

export interface BatchOperation {
  action: 'setState' | 'removeComponent' | 'dispatch' | 'navigate'
  target?: string
  /** For `dispatch`: `{ action, payload }` (`value` is accepted as a legacy alias). */
  payload?: unknown
}
