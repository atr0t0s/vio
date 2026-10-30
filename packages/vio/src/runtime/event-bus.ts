import type { VioEvent } from '../core/types'

export interface EventBusOptions {
  historySize?: number
}

type EventHandler = (event: VioEvent) => void

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>()
  private history: VioEvent[] = []
  private historySize: number
  private seq = 0

  constructor(options: EventBusOptions = {}) {
    this.historySize = options.historySize ?? 100
  }

  on(type: string, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler)
    return () => {
      this.listeners.get(type)?.delete(handler)
    }
  }

  emit(type: string, payload: Record<string, unknown> = {}): void {
    const event: VioEvent = {
      type: type as VioEvent['type'],
      payload,
      timestamp: Date.now(),
      seq: ++this.seq
    }

    this.record(event)

    this.listeners.get(type)?.forEach(h => this.call(h, event))
    if (type !== '*') {
      this.listeners.get('*')?.forEach(h => this.call(h, event))
    }
  }

  /** A throwing listener must not stop other listeners or the emitter. */
  private call(handler: EventHandler, event: VioEvent): void {
    try {
      handler(event)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.record({ type: 'listener:error', payload: { event: event.type, message }, timestamp: Date.now(), seq: ++this.seq })
      console.error(`[vio] listener for "${event.type}" threw:`, err)
    }
  }

  private record(event: VioEvent): void {
    if (this.historySize <= 0) return
    this.history.push(event)
    if (this.history.length > this.historySize) this.history.shift()
  }

  getHistory(): VioEvent[] {
    return [...this.history]
  }

  clear(): void {
    this.listeners.clear()
    this.history = []
  }
}
