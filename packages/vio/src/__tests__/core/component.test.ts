import { describe, it, expect } from 'vitest'
import { defineComponent, ComponentRegistry } from '../../core/component'

describe('defineComponent', () => {
  it('returns a component def', () => {
    const comp = defineComponent({
      name: 'Counter',
      state: { count: 0 },
      render(state) {
        return { tag: 'div', children: [String(state.count)] }
      }
    })
    expect(comp.name).toBe('Counter')
    expect(comp.state).toEqual({ count: 0 })
  })
})

describe('ComponentRegistry', () => {
  it('registers and retrieves components by name', () => {
    const registry = new ComponentRegistry()
    const comp = defineComponent({ name: 'Test', render: () => ({ tag: 'div' }) })
    registry.register(comp)
    expect(registry.get('Test')).toBe(comp)
  })

  it('throws on duplicate registration', () => {
    const registry = new ComponentRegistry()
    const comp = defineComponent({ name: 'Test', render: () => ({ tag: 'div' }) })
    registry.register(comp)
    expect(() => registry.register(comp)).toThrow()
  })

  it('lists all registered component names', () => {
    const registry = new ComponentRegistry()
    registry.register(defineComponent({ name: 'A', render: () => ({ tag: 'div' }) }))
    registry.register(defineComponent({ name: 'B', render: () => ({ tag: 'div' }) }))
    expect(registry.list()).toEqual(['A', 'B'])
  })
})
