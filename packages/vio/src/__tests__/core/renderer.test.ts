import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Renderer } from '../../core/renderer'
import { defineComponent } from '../../core/component'
import { EventBus } from '../../runtime/event-bus'

describe('Renderer', () => {
  let container: HTMLElement
  let bus: EventBus

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    bus = new EventBus()
  })

  it('renders a simple component', () => {
    const App = defineComponent({
      name: 'App',
      state: { message: 'Hello' },
      render(state) {
        return { tag: 'h1', children: [state.message as string] }
      }
    })

    const renderer = new Renderer(container, bus)
    renderer.mount(App)

    expect(container.innerHTML).toBe('<h1>Hello</h1>')
  })

  it('re-renders on state change', () => {
    const App = defineComponent({
      name: 'App',
      state: { count: 0 },
      render(state) {
        return { tag: 'span', children: [String(state.count)] }
      }
    })

    const renderer = new Renderer(container, bus)
    const instance = renderer.mount(App)
    expect(container.textContent).toBe('0')

    renderer.setState(instance.id, { count: 5 })
    expect(container.textContent).toBe('5')
  })

  it('emits component:mount event', () => {
    const handler = vi.fn()
    bus.on('component:mount', handler)

    const App = defineComponent({
      name: 'App',
      render: () => ({ tag: 'div' })
    })

    const renderer = new Renderer(container, bus)
    renderer.mount(App)

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'component:mount',
      payload: expect.objectContaining({ name: 'App' })
    }))
  })

  it('emits state:change event on setState', () => {
    const handler = vi.fn()
    bus.on('state:change', handler)

    const App = defineComponent({
      name: 'App',
      state: { x: 1 },
      render: (s) => ({ tag: 'div', children: [String(s.x)] })
    })

    const renderer = new Renderer(container, bus)
    const instance = renderer.mount(App)
    renderer.setState(instance.id, { x: 2 })

    expect(handler).toHaveBeenCalled()
  })

  it('calls onMount lifecycle hook', () => {
    const onMount = vi.fn()
    const App = defineComponent({
      name: 'App',
      render: () => ({ tag: 'div' }),
      onMount
    })

    const renderer = new Renderer(container, bus)
    renderer.mount(App)

    expect(onMount).toHaveBeenCalled()
  })

  it('renders nested components', () => {
    const Child = defineComponent({
      name: 'Child',
      state: { label: 'child' },
      render(state) {
        return { tag: 'span', children: [state.label as string] }
      }
    })

    const Parent = defineComponent({
      name: 'Parent',
      render() {
        return {
          tag: 'div',
          children: [
            { tag: Child, props: {}, children: [] }
          ]
        }
      }
    })

    const renderer = new Renderer(container, bus)
    renderer.mount(Parent)

    expect(container.innerHTML).toBe('<div><span>child</span></div>')
  })
})
