import type { VioEvent } from '../core/types'

export interface EventBusOptions {
  historySize?: number
}

type EventHandler = (event: VioEvent) => void

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>()
  private history: VioEvent[] = []
  private historySize: number

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
      timestamp: Date.now()
    }

    if (this.historySize > 0) {
      this.history.push(event)
      if (this.history.length > this.historySize) {
        this.history.shift()
      }
    }

    this.listeners.get(type)?.forEach(h => h(event))
    if (type !== '*') {
      this.listeners.get('*')?.forEach(h => h(event))
    }
  }

  getHistory(): VioEvent[] {
    return [...this.history]
  }

  clear(): void {
    this.listeners.clear()
    this.history = []
  }
}
