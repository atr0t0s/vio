import type { StoreConfig, ActionMeta } from '../core/types'
import { EventBus } from '../runtime/event-bus'

type StoreSubscriber = (newState: Record<string, unknown>, prevState: Record<string, unknown>) => void

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  const proto = Object.getPrototypeOf(value)
  // Only plain data: class instances may rely on mutating themselves.
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value
  Object.freeze(value)
  for (const v of Object.values(value as object)) deepFreeze(v)
  return value
}

export class Store {
  private state: Record<string, unknown>
  private actions: StoreConfig['actions']
  private bus: EventBus
  private subscribers: Set<StoreSubscriber> = new Set()
  private freeze: boolean
  readonly meta: Record<string, ActionMeta>

  constructor(config: StoreConfig, bus: EventBus) {
    this.freeze = config.freeze !== false
    this.state = this.seal({ ...config.state })
    this.actions = config.actions
    this.meta = config.meta ?? {}
    this.bus = bus
  }

  private seal(state: Record<string, unknown>): Record<string, unknown> {
    return this.freeze ? deepFreeze(state) : state
  }

  /** Shallow copy; nested values are frozen unless `freeze: false`. */
  getState(): Record<string, unknown> {
    return { ...this.state }
  }

  hasAction(action: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.actions, action)
  }

  actionNames(): string[] {
    return Object.keys(this.actions)
  }

  dispatch(action: string, payload?: unknown): void {
    const fn = this.hasAction(action) ? this.actions[action] : undefined
    if (!fn) throw new Error(`Unknown store action: "${action}"`)

    const prevState = this.state
    let next: unknown
    try {
      next = fn(this.state, payload)
    } catch (err) {
      if (err instanceof TypeError && this.freeze && /read.only|frozen|not extensible/i.test(err.message)) {
        throw new Error(`E_MUTATION: action "${action}" mutated state; return a new object instead (${err.message})`, { cause: err })
      }
      throw err
    }
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`E_ACTION_RESULT: action "${action}" must return a state object, got ${next === null ? 'null' : Array.isArray(next) ? 'array' : typeof next}`)
    }
    this.commit({ ...(next as Record<string, unknown>) }, prevState, { action, payload: payload as Record<string, unknown> ?? {} })
  }

  /** Replace the whole state (used to roll back a failed batch). */
  replace(state: Record<string, unknown>): void {
    this.commit({ ...state }, this.state, { action: '@replace', payload: {} })
  }

  private commit(next: Record<string, unknown>, prevState: Record<string, unknown>, info: { action: string; payload: Record<string, unknown> }): void {
    this.state = this.seal(next)
    this.bus.emit('store:change', { ...info, prev: { ...prevState }, next: { ...this.state } })
    this.subscribers.forEach(cb => cb({ ...this.state }, { ...prevState }))
  }

  subscribe(cb: StoreSubscriber): () => void {
    this.subscribers.add(cb)
    return () => { this.subscribers.delete(cb) }
  }
}
