export type RenderFunction = (state: Record<string, unknown>, store?: Record<string, unknown>) => VioNodeDescriptor

export interface VioNodeDescriptor {
  tag: string | RenderFunction | ComponentDef
  props?: Record<string, unknown>
  children?: VioChild[]
  key?: string | number
}

export type VioChild = VioNodeDescriptor | string | number | boolean | null | undefined

export interface ComponentDef {
  name: string
  state?: Record<string, unknown>
  render: RenderFunction
  onMount?: (ctx: ComponentContext) => void | (() => void)
  onUpdate?: (ctx: ComponentContext, prevState: Record<string, unknown>) => void
  onUnmount?: (ctx: ComponentContext) => void
}

export interface ComponentContext {
  setState: (partial: Record<string, unknown>) => void
  getState: () => Record<string, unknown>
  emit: (event: string, payload?: unknown) => void
  getRef: (name: string) => HTMLElement | null
}

export interface ComponentInstance {
  id: string
  def: ComponentDef
  state: Record<string, unknown>
  node: VioNodeDescriptor | null
  element: HTMLElement | null
  cleanup?: () => void
}

export interface Route {
  path: string
  component: ComponentDef
  guard?: (store: Record<string, unknown>) => boolean
}

export interface StoreAction {
  (state: Record<string, unknown>, payload?: unknown): Record<string, unknown>
}

export interface StoreConfig {
  state: Record<string, unknown>
  actions: Record<string, StoreAction>
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
  | 'route:before'
  | 'route:change'
  | 'route:after'
  | 'batch:start'
  | 'batch:end'

export interface VioEvent {
  type: VioEventType | string
  payload: Record<string, unknown>
  timestamp: number
}

export interface BatchOperation {
  action: 'setState' | 'addComponent' | 'removeComponent' | 'updateProps' | 'dispatch' | 'navigate'
  target?: string
  payload?: unknown
}
