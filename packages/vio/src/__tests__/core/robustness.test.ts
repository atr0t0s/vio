import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../../core/app'
import { defineComponent } from '../../core/component'
import { Renderer } from '../../core/renderer'
import { EventBus } from '../../runtime/event-bus'
import { Store } from '../../reactivity/store'

let container: HTMLElement

beforeEach(() => {
  window.location.hash = ''
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)
})

describe('event bus', () => {
  it('keeps calling listeners after one throws and records the failure', () => {
    const bus = new EventBus()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    bus.on('x', () => { throw new Error('bad listener') })
    bus.on('x', after)
    expect(() => bus.emit('x')).not.toThrow()
    expect(after).toHaveBeenCalled()
    expect(bus.getHistory().map(e => e.type)).toEqual(['x', 'listener:error'])
    spy.mockRestore()
  })

  it('numbers events in order', () => {
    const bus = new EventBus()
    bus.emit('a')
    bus.emit('b')
    const [a, b] = bus.getHistory()
    expect(b!.seq).toBe(a!.seq + 1)
  })
})

describe('store', () => {
  it('freezes state so mutating actions fail loudly', () => {
    const store = new Store({
      state: { todos: [{ done: false }] },
      actions: { bad: (s) => { (s.todos as { done: boolean }[])[0]!.done = true; return s } }
    }, new EventBus())
    expect(() => store.dispatch('bad')).toThrow(/E_MUTATION: action "bad"/)
    expect(() => { (store.getState().todos as unknown[]).push(1) }).toThrow()
  })

  it('can opt out of freezing', () => {
    const store = new Store({ state: { list: [] as number[] }, actions: {}, freeze: false }, new EventBus())
    ;(store.getState().list as number[]).push(1)
    expect(store.getState().list).toEqual([1])
  })

  it('rejects actions that do not return an object', () => {
    const store = new Store({ state: {}, actions: { oops: () => undefined as never } }, new EventBus())
    expect(() => store.dispatch('oops')).toThrow(/E_ACTION_RESULT: action "oops" must return a state object, got undefined/)
  })
})

describe('batch rollback', () => {
  it('undoes earlier state changes when a later op throws', () => {
    const Page = defineComponent({ name: 'Page', state: { title: 'a' }, render: (s, ctx) => ({ tag: 'p', children: [`${s.title}/${ctx.store.n}`] }) })
    const app = createApp({
      root: '#app',
      routes: [{ path: '/', component: Page }],
      store: { state: { n: 0 }, actions: { inc: (s) => ({ ...s, n: (s.n as number) + 1 }), boom: () => { throw new Error('nope') } } }
    })
    app.mount()
    expect(() => app.batch([
      { action: 'setState', target: 'Page', payload: { title: 'b' } },
      { action: 'dispatch', payload: { action: 'inc' } },
      { action: 'dispatch', payload: { action: 'boom' } }
    ])).toThrow('nope')
    expect(app.getStore().n).toBe(0)
    expect(app.getState('Page').title).toBe('a')
    expect(container.textContent).toBe('a/0')
  })
})

describe('error boundaries', () => {
  const Flaky = defineComponent({
    name: 'Flaky',
    render: (_s, ctx) => {
      if (ctx.props.fail) throw new Error('kaboom')
      return { tag: 'span', children: ['fine'] }
    }
  })
  const Boundary = defineComponent({
    name: 'Boundary',
    render: (_s, ctx) => ({ tag: 'section', children: [{ tag: 'b', children: ['kept?'] }, { tag: Flaky, props: { fail: ctx.props.fail } }] }),
    onError: (err) => ({ tag: 'p', props: { role: 'alert' }, children: [`failed: ${err.message}`] })
  })

  function mountWith(failAtStart: boolean) {
    const bus = new EventBus()
    const renderer = new Renderer(container, bus)
    const Root = defineComponent({
      name: 'Root',
      state: { fail: failAtStart },
      render: (s) => ({ tag: 'main', children: [{ tag: 'h1', children: ['title'] }, { tag: Boundary, props: { fail: s.fail } }] })
    })
    const root = renderer.mount(Root)
    return { renderer, bus, root }
  }

  it('renders the fallback when a child throws on first render', () => {
    mountWith(true)
    expect(container.querySelector('h1')!.textContent).toBe('title')
    expect(container.querySelector('[role=alert]')!.textContent).toBe('failed: E_RENDER Root/Boundary/Flaky: kaboom')
  })

  it('recovers when props change, and catches errors on update', () => {
    const { renderer, root, bus } = mountWith(false)
    expect(container.querySelector('section')!.textContent).toBe('kept?fine')
    renderer.setState(root.id, { fail: true })
    expect(container.querySelector('section')).toBeNull()
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    expect(renderer.getInstance('Root/Boundary/Flaky')).toBeUndefined()
    expect(bus.getHistory().some(e => e.type === 'component:error' && e.payload.handled)).toBe(true)
    renderer.setState(root.id, { fail: false })
    expect(container.querySelector('section')!.textContent).toBe('kept?fine')
  })

  it('catches a descendant that re-renders on its own', () => {
    let setFail: (v: boolean) => void = () => {}
    const SelfFlaky = defineComponent({
      name: 'SelfFlaky',
      state: { fail: false },
      render: (s, ctx) => {
        setFail = (v) => ctx.setState({ fail: v })
        if (s.fail) throw new Error('self')
        return { tag: 'i', children: ['ok'] }
      }
    })
    const B = defineComponent({ name: 'B', render: () => ({ tag: 'div', children: [{ tag: SelfFlaky }] }), onError: () => ({ tag: 'em', children: ['oops'] }) })
    new Renderer(container, new EventBus()).mount(B)
    setFail(true)
    expect(container.innerHTML).toBe('<em>oops</em>')
  })

  it('still throws when there is no boundary', () => {
    const renderer = new Renderer(container, new EventBus())
    expect(() => renderer.mount(defineComponent({ name: 'X', render: () => ({ tag: 'div', children: [{ tag: Flaky, props: { fail: true } }] }) }))).toThrow(/kaboom/)
  })
})

describe('controlled inputs', () => {
  it('reverts an edit the handler did not accept', () => {
    const Upper = defineComponent({
      name: 'Upper',
      state: { v: 'AB' },
      // Only accepts uppercase input
      render: (s, ctx) => ({ tag: 'input', props: { value: s.v, onInput: (e: Event) => {
        const next = (e.target as HTMLInputElement).value
        if (next === next.toUpperCase()) ctx.setState({ v: next })
      } } })
    })
    new Renderer(container, new EventBus()).mount(Upper)
    const input = container.querySelector('input')!
    input.value = 'ABc'
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('AB')
    input.value = 'ABC'
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('ABC')
  })

  it('reverts a checkbox click the handler ignored', () => {
    const Locked = defineComponent({ name: 'Locked', render: () => ({ tag: 'input', props: { type: 'checkbox', checked: false, onChange: () => {} } }) })
    new Renderer(container, new EventBus()).mount(Locked)
    const box = container.querySelector('input')!
    box.click()
    expect(box.checked).toBe(false)
  })
})
