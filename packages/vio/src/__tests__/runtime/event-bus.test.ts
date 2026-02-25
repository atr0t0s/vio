import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../runtime/event-bus'

describe('EventBus', () => {
  it('emits and receives events', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.on('test', handler)
    bus.emit('test', { value: 42 })
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'test',
      payload: { value: 42 }
    }))
  })

  it('supports multiple listeners', () => {
    const bus = new EventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.on('test', h1)
    bus.on('test', h2)
    bus.emit('test', {})
    expect(h1).toHaveBeenCalled()
    expect(h2).toHaveBeenCalled()
  })

  it('unsubscribes with returned function', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    const unsub = bus.on('test', handler)
    unsub()
    bus.emit('test', {})
    expect(handler).not.toHaveBeenCalled()
  })

  it('supports wildcard listener', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.on('*', handler)
    bus.emit('state:change', { id: '1' })
    bus.emit('route:change', { path: '/' })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('includes timestamp on events', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.on('test', handler)
    bus.emit('test', {})
    expect(handler.mock.calls[0][0].timestamp).toBeTypeOf('number')
  })

  it('returns event history', () => {
    const bus = new EventBus({ historySize: 10 })
    bus.emit('a', { v: 1 })
    bus.emit('b', { v: 2 })
    const history = bus.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0].type).toBe('a')
  })
})
