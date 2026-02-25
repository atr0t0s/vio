import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Router } from '../../router/router'
import { EventBus } from '../../runtime/event-bus'
import { defineComponent } from '../../core/component'

const Home = defineComponent({ name: 'Home', render: () => ({ tag: 'div', children: ['Home'] }) })
const Users = defineComponent({ name: 'Users', render: () => ({ tag: 'div', children: ['Users'] }) })
const UserDetail = defineComponent({
  name: 'UserDetail',
  render: (state) => ({ tag: 'div', children: [`User ${state.params?.id}`] })
})
const NotFound = defineComponent({ name: 'NotFound', render: () => ({ tag: 'div', children: ['404'] }) })

describe('Router', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  it('matches exact paths', () => {
    const router = new Router([
      { path: '/', component: Home },
      { path: '/users', component: Users }
    ], bus)

    const match = router.resolve('/')
    expect(match?.component.name).toBe('Home')
  })

  it('matches parameterized paths', () => {
    const router = new Router([
      { path: '/users/:id', component: UserDetail }
    ], bus)

    const match = router.resolve('/users/42')
    expect(match?.component.name).toBe('UserDetail')
    expect(match?.params).toEqual({ id: '42' })
  })

  it('matches wildcard routes', () => {
    const router = new Router([
      { path: '/', component: Home },
      { path: '*', component: NotFound }
    ], bus)

    const match = router.resolve('/anything')
    expect(match?.component.name).toBe('NotFound')
  })

  it('returns null for no match and no wildcard', () => {
    const router = new Router([
      { path: '/', component: Home }
    ], bus)

    const match = router.resolve('/nope')
    expect(match).toBeNull()
  })

  it('emits route:change on navigate', () => {
    const handler = vi.fn()
    bus.on('route:change', handler)

    const router = new Router([
      { path: '/', component: Home },
      { path: '/users', component: Users }
    ], bus)

    router.navigate('/users')
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'route:change'
    }))
  })

  it('respects route guards', () => {
    const router = new Router([
      { path: '/admin', component: Home, guard: () => false },
      { path: '*', component: NotFound }
    ], bus)

    // Need to set store getter for guards to be evaluated
    router.setStoreGetter(() => ({}))

    const match = router.resolve('/admin')
    expect(match?.component.name).toBe('NotFound')
  })

  it('returns current route', () => {
    const router = new Router([
      { path: '/', component: Home }
    ], bus)

    router.navigate('/')
    expect(router.getCurrentRoute()?.path).toBe('/')
  })
})
