import type { AppConfig, ComponentDef, BatchOperation } from './types'
import { ComponentRegistry } from './component'
import { Renderer } from './renderer'
import { EventBus } from '../runtime/event-bus'
import { Store } from '../reactivity/store'
import { Router } from '../router/router'

export interface VioApp {
  mount(): void
  setState(instanceId: string, partial: Record<string, unknown>): void
  getState(instanceId: string): Record<string, unknown>
  dispatch(action: string, payload?: unknown): void
  getStore(): Record<string, unknown>
  on(event: string, handler: (e: any) => void): () => void
  emit(event: string, payload?: Record<string, unknown>): void
  register(def: ComponentDef): void
  getRegisteredComponents(): string[]
  removeComponent(instanceId: string): void
  getComponentTree(): { id: string; name: string; state: Record<string, unknown>; children: any[] }
  navigate(path: string): void
  batch(ops: BatchOperation[]): void
}

export function createApp(config: AppConfig): VioApp {
  const bus = new EventBus({ historySize: 100 })
  const registry = new ComponentRegistry()

  const rootEl = typeof config.root === 'string'
    ? document.querySelector(config.root) as HTMLElement
    : config.root

  if (!rootEl) throw new Error(`Root element "${config.root}" not found`)

  const renderer = new Renderer(rootEl, bus)
  const store = config.store ? new Store(config.store, bus) : null
  const router = config.routes ? new Router(config.routes, bus) : null

  if (router && store) {
    router.setStoreGetter(() => store.getState())
  }

  let rootInstanceId: string | null = null
  let hashCleanup: (() => void) | null = null

  return {
    mount() {
      const hash = window.location.hash
      const path = hash ? hash.replace(/^#/, '') || '/' : '/'

      if (router) {
        const match = router.navigate(path)
        if (match) {
          const instance = renderer.mount(match.component)
          rootInstanceId = instance.id
        }

        const onHashChange = () => {
          const newHash = window.location.hash
          const newPath = newHash ? newHash.replace(/^#/, '') || '/' : '/'
          const newMatch = router.navigate(newPath)
          if (newMatch) {
            if (rootInstanceId) {
              renderer.unmount(rootInstanceId)
            }
            const instance = renderer.mount(newMatch.component)
            rootInstanceId = instance.id
          }
        }

        window.addEventListener('hashchange', onHashChange)
        hashCleanup = () => {
          window.removeEventListener('hashchange', onHashChange)
          hashCleanup = null
        }
      } else if (config.routes && config.routes.length > 0) {
        const instance = renderer.mount(config.routes[0]!.component)
        rootInstanceId = instance.id
      }
    },

    setState(instanceId, partial) {
      renderer.setState(instanceId, partial)
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
      renderer.unmount(instanceId)
      if (instanceId === rootInstanceId && hashCleanup) {
        hashCleanup()
      }
    },

    getComponentTree() {
      if (!rootInstanceId) return { id: '', name: '', state: {}, children: [] }
      const inst = renderer.getInstance(rootInstanceId)
      if (!inst) return { id: '', name: '', state: {}, children: [] }
      return {
        id: inst.id,
        name: inst.def.name,
        state: { ...inst.state },
        children: []
      }
    },

    navigate(path) {
      if (!router) throw new Error('No routes configured')
      const match = router.navigate(path)
      if (match) {
        if (rootInstanceId) {
          renderer.unmount(rootInstanceId)
        }
        const instance = renderer.mount(match.component)
        rootInstanceId = instance.id
      }
    },

    batch(ops) {
      bus.emit('batch:start', { operations: ops.length })
      for (const op of ops) {
        switch (op.action) {
          case 'setState':
            if (op.target) renderer.setState(op.target, op.payload as Record<string, unknown>)
            break
          case 'dispatch':
            if (store && op.payload) {
              const p = op.payload as { action: string; value?: unknown }
              store.dispatch(p.action, p.value)
            }
            break
          case 'removeComponent':
            if (op.target) renderer.unmount(op.target)
            break
          case 'navigate':
            if (router && op.target) {
              const match = router.navigate(op.target)
              if (match && rootInstanceId) {
                renderer.unmount(rootInstanceId)
                const instance = renderer.mount(match.component)
                rootInstanceId = instance.id
              }
            }
            break
        }
      }
      bus.emit('batch:end', { operations: ops.length })
    }
  }
}
