import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../../core/app'
import { defineComponent } from '../../core/component'
import { Router } from '../../router/router'
import { EventBus } from '../../runtime/event-bus'

let container: HTMLElement

beforeEach(() => {
  window.location.hash = ''
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)
})

const Home = defineComponent({ name: 'Home', render: () => ({ tag: 'p', children: ['home'] }) })
const User = defineComponent({
  name: 'User',
  state: { visits: 0 },
  render: (s, ctx) => ({ tag: 'p', children: [`user ${ctx.route.params.id} q=${ctx.route.query.tab ?? ''} p=${(s.params as Record<string, string>).id} v=${s.visits}`] })
})

describe('routing', () => {
  it('delivers params and query to the component', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Home }, { path: '/users/:id', component: User }] })
    app.mount()
    app.navigate('/users/42?tab=posts')
    expect(container.textContent).toBe('user 42 q=posts p=42 v=0')
    expect(app.getRoute()).toEqual({ path: '/users/42', params: { id: '42' }, query: { tab: 'posts' } })
  })

  it('keeps component state when only params change', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/users/:id', component: User }] })
    window.location.hash = '#/users/1'
    app.mount()
    app.setState(app.getComponentTree().id, { visits: 5 })
    app.navigate('/users/2')
    expect(container.textContent).toBe('user 2 q= p=2 v=5')
  })

  it('clears the page and reports when no route matches', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Home }] })
    const notFound = vi.fn()
    app.on('route:notfound', notFound)
    app.mount()
    expect(app.navigate('/nope')).toBe(false)
    expect(container.textContent).toBe('')
    expect(notFound).toHaveBeenCalledWith(expect.objectContaining({ payload: { path: '/nope' } }))
    expect(window.location.hash).toBe('#/nope')
  })

  it('does not swallow the next hashchange after navigating to the current path', () => {
    const Other = defineComponent({ name: 'Other', render: () => ({ tag: 'p', children: ['other'] }) })
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Home }, { path: '/other', component: Other }] })
    app.mount()
    app.navigate('/')
    window.location.hash = '#/other'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(container.textContent).toBe('other')
  })

  it('redirects when a guard returns a path', () => {
    const Login = defineComponent({ name: 'Login', render: () => ({ tag: 'p', children: ['login'] }) })
    const app = createApp({
      root: '#app',
      routes: [{ path: '/admin', component: Home, guard: (s) => s.user ? true : '/login' }, { path: '/login', component: Login }],
      store: { state: { user: null }, actions: {} }
    })
    app.mount()
    app.navigate('/admin')
    expect(container.textContent).toBe('login')
    expect(window.location.hash).toBe('#/login')
  })

  it('destroy removes listeners and DOM', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Home }, { path: '/u/:id', component: User }] })
    app.mount()
    app.destroy()
    expect(container.innerHTML).toBe('')
    window.location.hash = '#/u/1'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(container.innerHTML).toBe('')
  })
})

describe('Router guards', () => {
  it('runs guards even without a store (fails closed)', () => {
    const router = new Router([{ path: '/admin', component: Home, guard: () => false }], new EventBus())
    expect(router.resolve('/admin')).toBeNull()
  })

  it('detects redirect loops', () => {
    const router = new Router([{ path: '/a', component: Home, guard: () => '/b' }, { path: '/b', component: Home, guard: () => '/a' }], new EventBus())
    expect(() => router.resolve('/a')).toThrow(/E_REDIRECT_LOOP/)
  })

  it('decodes params and tolerates malformed encoding', () => {
    const router = new Router([{ path: '/f/:name', component: Home }], new EventBus())
    expect(router.resolve('/f/a%20b?x=1+2&y=%E0')!).toMatchObject({ params: { name: 'a b' }, query: { x: '1 2', y: '%E0' } })
  })
})

describe('store and batch', () => {
  const Counter = defineComponent({
    name: 'Counter',
    render: (_s, ctx) => ({ tag: 'button', props: { onClick: () => ctx.dispatch('inc') }, children: [String(ctx.store.n)] })
  })
  const storeConfig = () => ({ state: { n: 0 }, actions: { inc: (s: Record<string, unknown>) => ({ ...s, n: (s.n as number) + 1 }), set: (_s: Record<string, unknown>, v: unknown) => ({ n: v }) } })

  it('exposes store and dispatch through ctx', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Counter }], store: storeConfig() })
    app.mount()
    container.querySelector('button')!.click()
    expect(container.textContent).toBe('1')
  })

  it('applies a batch with one render and accepts payload or value', () => {
    const render = vi.fn((_s: Record<string, unknown>, ctx: { store: Record<string, unknown> }) => ({ tag: 'i', children: [String(ctx.store.n)] }))
    const C = defineComponent({ name: 'C', render: render as never })
    const app = createApp({ root: '#app', routes: [{ path: '/', component: C }], store: storeConfig() })
    app.mount()
    render.mockClear()
    app.batch([
      { action: 'dispatch', payload: { action: 'inc' } },
      { action: 'dispatch', payload: { action: 'set', payload: 10 } },
      { action: 'dispatch', payload: { action: 'set', value: 7 } }
    ])
    expect(render).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('7')
  })

  it('rejects an invalid batch before applying anything', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Counter }], store: storeConfig() })
    app.mount()
    expect(() => app.batch([
      { action: 'dispatch', payload: { action: 'inc' } },
      { action: 'dispatch', payload: { action: 'missing' } }
    ])).toThrow(/E_UNKNOWN_ACTION batch\[1\]/)
    expect(app.getStore().n).toBe(0)
    expect(() => app.batch([{ action: 'addComponent' as never }])).toThrow(/E_BATCH_ACTION/)
  })

  it('does not resolve actions from the prototype chain', () => {
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Counter }], store: storeConfig() })
    expect(() => app.dispatch('toString')).toThrow(/Unknown store action/)
  })
})
