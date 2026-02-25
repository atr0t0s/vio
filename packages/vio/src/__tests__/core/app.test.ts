import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../../core/app'
import { defineComponent } from '../../core/component'

const App = defineComponent({
  name: 'App',
  state: { message: 'Hello' },
  render(state) {
    return { tag: 'div', props: { id: 'app-root' }, children: [state.message as string] }
  }
})

const Page2 = defineComponent({
  name: 'Page2',
  state: { title: 'Page 2' },
  render(state) {
    return { tag: 'h1', children: [state.title as string] }
  }
})

describe('createApp', () => {
  let container: HTMLElement

  beforeEach(() => {
    window.location.hash = ''
    container = document.createElement('div')
    container.id = 'app'
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  it('mounts a root component', () => {
    const app = createApp({
      root: '#app',
      routes: [{ path: '/', component: App }]
    })
    app.mount()
    expect(container.textContent).toBe('Hello')
  })

  it('provides getState/setState', () => {
    const app = createApp({
      root: '#app',
      routes: [{ path: '/', component: App }]
    })
    app.mount()
    const rootId = app.getComponentTree().id
    expect(app.getState(rootId)).toEqual(expect.objectContaining({ message: 'Hello' }))
    app.setState(rootId, { message: 'World' })
    expect(container.textContent).toBe('World')
  })

  it('provides global store dispatch', () => {
    const app = createApp({
      root: '#app',
      routes: [{ path: '/', component: App }],
      store: {
        state: { count: 0 },
        actions: {
          increment(s) { return { ...s, count: (s.count as number) + 1 } }
        }
      }
    })
    app.mount()

    app.dispatch('increment')
    expect(app.getStore().count).toBe(1)
  })

  it('provides event bus on/emit', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: App }] })
    const handler = vi.fn()
    app.on('custom:event', handler)
    app.emit('custom:event', { data: 1 })
    expect(handler).toHaveBeenCalled()
  })

  it('provides component registration', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: App }] })
    app.register(Page2)
    expect(app.getRegisteredComponents()).toContain('Page2')
  })

  it('supports batch operations', () => {
    const app = createApp({
      root: '#app',
      routes: [{ path: '/', component: App }],
      store: {
        state: { count: 0 },
        actions: { set(_, v) { return { count: v } } }
      }
    })
    app.mount()
    const rootId = app.getComponentTree().id

    app.batch([
      { action: 'setState', target: rootId, payload: { message: 'Batched' } },
      { action: 'dispatch', payload: { action: 'set', value: 99 } }
    ])

    expect(container.textContent).toBe('Batched')
    expect(app.getStore().count).toBe(99)
  })

  it('supports navigate', () => {
    const app = createApp({
      root: '#app',
      routes: [
        { path: '/', component: App },
        { path: '/page2', component: Page2 }
      ]
    })
    app.mount()
    expect(container.textContent).toBe('Hello')

    app.navigate('/page2')
    expect(container.textContent).toBe('Page 2')
  })

  it('reads initial route from location.hash on mount', () => {
    window.location.hash = '#/page2'
    const app = createApp({
      root: '#app',
      routes: [
        { path: '/', component: App },
        { path: '/page2', component: Page2 }
      ]
    })
    app.mount()
    expect(container.textContent).toBe('Page 2')
  })

  it('responds to hashchange events', () => {
    const app = createApp({
      root: '#app',
      routes: [
        { path: '/', component: App },
        { path: '/page2', component: Page2 }
      ]
    })
    app.mount()
    expect(container.textContent).toBe('Hello')

    window.location.hash = '#/page2'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(container.textContent).toBe('Page 2')
  })

  it('cleans up hashchange listener on unmount of last component', () => {
    const app = createApp({
      root: '#app',
      routes: [
        { path: '/', component: App },
        { path: '/page2', component: Page2 }
      ]
    })
    app.mount()
    const rootId = app.getComponentTree().id
    app.removeComponent(rootId)

    window.location.hash = '#/page2'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(container.textContent).toBe('')
  })

  it('getEventHistory returns bus history', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: App }] })
    app.mount()
    const history = app.getEventHistory()
    expect(Array.isArray(history)).toBe(true)
    expect(history.length).toBeGreaterThan(0)
  })

  it('provides getComponentTree', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: App }] })
    app.mount()
    const tree = app.getComponentTree()
    expect(tree.name).toBe('App')
    expect(tree.state).toEqual(expect.objectContaining({ message: 'Hello' }))
  })
})
