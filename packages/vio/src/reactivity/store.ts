import type { StoreConfig } from '../core/types'
import { EventBus } from '../runtime/event-bus'

type StoreSubscriber = (newState: Record<string, unknown>, prevState: Record<string, unknown>) => void

export class Store {
  private state: Record<string, unknown>
  private actions: StoreConfig['actions']
  private bus: EventBus
  private subscribers: Set<StoreSubscriber> = new Set()

  constructor(config: StoreConfig, bus: EventBus) {
    this.state = { ...config.state }
    this.actions = config.actions
    this.bus = bus
  }

  getState(): Record<string, unknown> {
    return { ...this.state }
  }

  dispatch(action: string, payload?: unknown): void {
    const fn = this.actions[action]
    if (!fn) throw new Error(`Unknown store action: "${action}"`)

    const prevState = { ...this.state }
    this.state = { ...fn(this.state, payload) }

    this.bus.emit('store:change', {
      action,
      payload: payload as Record<string, unknown> ?? {},
      prev: prevState,
      next: { ...this.state }
    })

    this.subscribers.forEach(cb => cb({ ...this.state }, prevState))
  }

  subscribe(cb: StoreSubscriber): () => void {
    this.subscribers.add(cb)
    return () => { this.subscribers.delete(cb) }
  }
}
