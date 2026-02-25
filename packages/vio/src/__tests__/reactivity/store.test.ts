import { describe, it, expect, vi } from 'vitest'
import { Store } from '../../reactivity/store'
import { EventBus } from '../../runtime/event-bus'

describe('Store', () => {
  it('initializes with state', () => {
    const bus = new EventBus()
    const store = new Store({ state: { count: 0 }, actions: {} }, bus)
    expect(store.getState()).toEqual({ count: 0 })
  })

  it('dispatches actions to produce new state', () => {
    const bus = new EventBus()
    const store = new Store({
      state: { count: 0 },
      actions: {
        increment(state) { return { ...state, count: (state.count as number) + 1 } }
      }
    }, bus)

    store.dispatch('increment')
    expect(store.getState().count).toBe(1)
  })

  it('passes payload to actions', () => {
    const bus = new EventBus()
    const store = new Store({
      state: { count: 0 },
      actions: {
        add(state, amount) { return { ...state, count: (state.count as number) + (amount as number) } }
      }
    }, bus)

    store.dispatch('add', 5)
    expect(store.getState().count).toBe(5)
  })

  it('emits store:change event', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.on('store:change', handler)

    const store = new Store({
      state: { x: 1 },
      actions: { set(_, val) { return { x: val } } }
    }, bus)

    store.dispatch('set', 42)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'store:change',
      payload: expect.objectContaining({ action: 'set' })
    }))
  })

  it('returns immutable state snapshots', () => {
    const bus = new EventBus()
    const store = new Store({ state: { items: [] }, actions: {} }, bus)
    const s1 = store.getState()
    const s2 = store.getState()
    expect(s1).toEqual(s2)
    expect(s1).not.toBe(s2)
  })

  it('throws on unknown action', () => {
    const bus = new EventBus()
    const store = new Store({ state: {}, actions: {} }, bus)
    expect(() => store.dispatch('nonexistent')).toThrow()
  })

  it('supports subscribe for state changes', () => {
    const bus = new EventBus()
    const store = new Store({
      state: { v: 0 },
      actions: { set(_, v) { return { v } } }
    }, bus)

    const cb = vi.fn()
    store.subscribe(cb)
    store.dispatch('set', 1)
    expect(cb).toHaveBeenCalledWith({ v: 1 }, { v: 0 })
  })
})
